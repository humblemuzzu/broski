import 'dart:async';
import 'dart:convert';

import 'package:broski/services/websocket/bridge_transport.dart';
import 'package:broski/services/websocket/inbound_frame_limit.dart';
import 'package:broski/services/websocket/json_message_decoder.dart';
import 'package:broski_link/broski_link.dart' show linkOutboundQueueMax;
import 'package:flutter/foundation.dart' show debugPrint;

enum ConnectionStatus { disconnected, connecting, connected }

/// Message priority for batching decisions.
/// Immediate messages bypass batching entirely.
enum MessagePriority { immediate, high, normal, low }

/// Batch windows in milliseconds, chosen by measured round-trip time.
class BatchThresholds {
  final int low;
  final int high;

  const BatchThresholds({required this.low, required this.high});

  static const local = BatchThresholds(low: 50, high: 25);
  static const remote = BatchThresholds(low: 100, high: 50);
  static const highLatency = BatchThresholds(low: 150, high: 75);
}

/// The bridge protocol over a [BridgeTransport]: outgoing batching, incoming
/// JSON decoding off the UI isolate, and the connection status the app sees.
class WebSocketService {
  BridgeTransport? _channel;
  StreamSubscription<dynamic>? _channelSubscription;
  ConnectionStatus _status = ConnectionStatus.disconnected;
  int _connectionId = 0;

  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  final _statusController = StreamController<ConnectionStatus>.broadcast();

  final List<Map<String, dynamic>> _pendingBatch = [];
  Timer? _batchTimer;
  int _currentRttMs = 0;

  /// Messages sent before a transport is attached; flushed on attach.
  final List<Map<String, dynamic>> _detachedQueue = [];
  static const _maxQueueSize = 50;

  final List<String> _rawQueue = [];
  final WebSocketJsonMessageDecoder _jsonDecoder =
      WebSocketJsonMessageDecoder();
  bool _isDecoding = false;
  final _frameErrors = StreamController<String>.broadcast();

  static const _immediateTypes = {
    'permission_response',
    'cc_permission_response',
    'cx_permission_response',
    'cx_chat',
    'oc_question_reply',
    'oc_question_reject',
    'abort',
    'cc_abort',
    'pong',
    'set_view',
    'cc_chat',
  };

  static const _highPriorityTypes = {
    'chat',
    'execute_command',
    'create_session',
    'delete_session',
  };

  Stream<Map<String, dynamic>> get messages => _messageController.stream;

  /// Frames the app refused to decode, with what it lost. An over-limit frame is
  /// a reported error, never a silent drop.
  Stream<String> get frameErrors => _frameErrors.stream;
  Stream<ConnectionStatus> get statusStream => _statusController.stream;
  ConnectionStatus get status => _status;

  void updateRtt(int rttMs) {
    _currentRttMs = rttMs;
  }

  /// Runs the protocol over [transport], replacing any previous one. Status
  /// comes from the transport's owner through [applyTransportStatus].
  Future<void> connect(BridgeTransport transport) async {
    final thisConnectionId = ++_connectionId;
    await _channelSubscription?.cancel();
    _channelSubscription = null;
    await _channel?.close();
    _batchTimer?.cancel();
    _pendingBatch.clear();
    _setStatus(ConnectionStatus.connecting);
    _channel = transport;
    _channelSubscription = transport.stream.listen(
      (event) {
        if (_connectionId != thisConnectionId) return;
        if (event is String) {
          _handleMessage(event);
        } else if (event is List<int>) {
          _handleBytes(event);
        }
      },
      onError: (_) {
        if (_connectionId != thisConnectionId) return;
        _setStatus(ConnectionStatus.disconnected);
      },
      onDone: () {
        if (_connectionId != thisConnectionId) return;
        _setStatus(ConnectionStatus.disconnected);
      },
      cancelOnError: true,
    );
    _flushDetachedQueue();
  }

  /// Sends [message], batching by priority. Returns false only when dropped.
  bool send(Map<String, dynamic> message) {
    final channel = _channel;
    if (channel == null) return _queueDetached(message);
    final priority = _getPriority(message['type'] as String? ?? '');
    if (priority == MessagePriority.immediate) {
      channel.sink.add(jsonEncode(message), tag: _tagOf(message));
      return true;
    }
    _pendingBatch.add(message);
    if (_batchTimer == null || !_batchTimer!.isActive) {
      _batchTimer = Timer(
        Duration(milliseconds: _getBatchDelay(priority)),
        _flushBatch,
      );
    }
    return true;
  }

  bool sendImmediate(Map<String, dynamic> message) {
    final channel = _channel;
    if (channel == null) return _queueDetached(message);
    channel.sink.add(jsonEncode(message), tag: _tagOf(message));
    return true;
  }

  /// The request this message is waiting for a reply to, if any: the caller
  /// fails it the moment the link says the message never left.
  String? _tagOf(Map<String, dynamic> message) {
    final requestId = message['requestId'];
    return requestId is String && requestId.isNotEmpty ? requestId : null;
  }

  bool _queueDetached(Map<String, dynamic> message) {
    final type = message['type'] as String? ?? '';
    if (type == 'pong') return false;
    if (_detachedQueue.length >= _maxQueueSize) _detachedQueue.removeAt(0);
    _detachedQueue.add(message);
    return true;
  }

  void _flushDetachedQueue() {
    final channel = _channel;
    if (channel == null || _detachedQueue.isEmpty) return;
    for (final message in _detachedQueue) {
      channel.sink.add(jsonEncode(message), tag: _tagOf(message));
    }
    _detachedQueue.clear();
  }

  MessagePriority _getPriority(String type) {
    if (_immediateTypes.contains(type)) return MessagePriority.immediate;
    if (_highPriorityTypes.contains(type)) return MessagePriority.high;
    return MessagePriority.normal;
  }

  int _getBatchDelay(MessagePriority priority) {
    final thresholds = _currentRttMs > 100
        ? BatchThresholds.highLatency
        : _currentRttMs > 30
        ? BatchThresholds.remote
        : BatchThresholds.local;
    return priority == MessagePriority.high ? thresholds.high : thresholds.low;
  }

  void _flushBatch() {
    _batchTimer = null;
    if (_pendingBatch.isEmpty) return;
    final channel = _channel;
    if (channel == null) {
      _pendingBatch.forEach(_queueDetached);
      _pendingBatch.clear();
      return;
    }
    if (_pendingBatch.length == 1) {
      final message = _pendingBatch.first;
      channel.sink.add(jsonEncode(message), tag: _tagOf(message));
      _pendingBatch.clear();
      return;
    }
    final batch = jsonEncode({
      'type': 'batch',
      'messages': List<Map<String, dynamic>>.from(_pendingBatch),
      'count': _pendingBatch.length,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
    // A merged frame names no single request, so it carries no tag: one the link
    // would refuse goes out as its parts instead, each with its own.
    if (utf8.encode(batch).length > linkOutboundQueueMax) {
      for (final message in _pendingBatch) {
        channel.sink.add(jsonEncode(message), tag: _tagOf(message));
      }
    } else {
      channel.sink.add(batch);
    }
    _pendingBatch.clear();
  }

  /// Publishes the connection state the transport's owner decided.
  void applyTransportStatus(ConnectionStatus status) => _setStatus(status);

  Future<void> disconnect() async {
    _connectionId++;
    _batchTimer?.cancel();
    _pendingBatch.clear();
    _detachedQueue.clear();
    await _channelSubscription?.cancel();
    _channelSubscription = null;
    await _channel?.close();
    _channel = null;
    _setStatus(ConnectionStatus.disconnected);
  }

  void dispose() {
    _connectionId++;
    _batchTimer?.cancel();
    _pendingBatch.clear();
    _detachedQueue.clear();
    _channelSubscription?.cancel();
    _channelSubscription = null;
    _channel?.close();
    _channel = null;
    _messageController.close();
    _statusController.close();
    _frameErrors.close();
  }

  void _handleBytes(List<int> bytes) {
    if (bytes.length > linkMaxInboundFrameBytes) {
      _reportOversizedFrame(bytes.length);
      return;
    }
    _handleMessage(utf8.decode(bytes));
  }

  void _handleMessage(String raw) {
    if (raw.length > linkMaxInboundFrameBytes) {
      _reportOversizedFrame(raw.length);
      return;
    }
    _rawQueue.add(raw);
    if (_isDecoding) return;
    _isDecoding = true;
    unawaited(_drainRawQueue());
  }

  Future<void> _drainRawQueue() async {
    try {
      while (_rawQueue.isNotEmpty) {
        final data = await _jsonDecoder.decode(_rawQueue.removeAt(0));
        if (data.isEmpty) continue;
        _dispatch(data);
      }
    } catch (_) {
      debugPrint('[WebSocket] Dropped malformed payload');
    } finally {
      _isDecoding = false;
    }
  }

  void _dispatch(Map<String, dynamic> data) {
    switch (data['type']) {
      case 'batch':
        final messages = data['messages'];
        if (messages is! List) return;
        for (final entry in messages.whereType<Map>()) {
          _messageController.add(
            entry.map((key, value) => MapEntry(key.toString(), value)),
          );
        }
      case 'ping':
        // The bridge closes a client that stops answering its heartbeat.
        final payload = data['data'] as Map<String, dynamic>? ?? const {};
        final id = payload['id'] as String? ?? '';
        final sentAt = payload['sentAt'] as int? ?? 0;
        if (id.isNotEmpty && sentAt > 0) {
          sendImmediate({'type': 'pong', 'id': id, 'sentAt': sentAt});
        }
      case 'client_pong':
      case 'tick':
        return;
      default:
        _messageController.add(data);
    }
  }

  void _reportOversizedFrame(int bytes) {
    final message = oversizedInboundFrameMessage(bytes);
    debugPrint('[WebSocket] $message');
    if (!_frameErrors.isClosed) _frameErrors.add(message);
  }

  void _setStatus(ConnectionStatus status) {
    _status = status;
    _statusController.add(status);
  }
}
