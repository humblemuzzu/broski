import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

enum ConnectionStatus { disconnected, connecting, connected }

/// Message priority for batching decisions.
/// Immediate messages bypass batching entirely.
enum MessagePriority { immediate, high, normal, low }

/// Batch thresholds in milliseconds based on connection type.
class BatchThresholds {
  final int low; // Low traffic delay
  final int high; // High traffic delay

  const BatchThresholds({required this.low, required this.high});

  static const local = BatchThresholds(low: 50, high: 25);
  static const tailscale = BatchThresholds(low: 100, high: 50);
  static const highLatency = BatchThresholds(low: 150, high: 75);
}

class WebSocketService {
  WebSocketChannel? _channel;
  ConnectionStatus _status = ConnectionStatus.disconnected;

  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  final _statusController = StreamController<ConnectionStatus>.broadcast();

  // Batching state
  final List<Map<String, dynamic>> _pendingBatch = [];
  Timer? _batchTimer;
  int _currentRttMs = 0;
  String _connectionType = 'unknown';

  // Ping/pong heartbeat state
  Timer? _pingTimer;
  Timer? _pongTimeoutTimer;
  DateTime? _lastPongReceived;
  static const _pingInterval = Duration(seconds: 15);
  static const _pongTimeout = Duration(seconds: 10);
  bool _waitingForPong = false;

  // Message types that should be sent immediately (bypass batching)
  static const _immediateTypes = {
    'permission_response',
    'abort',
    'pong',
    'set_view',
  };

  // Message types with high priority (shorter batch window)
  static const _highPriorityTypes = {
    'chat',
    'execute_command',
    'create_session',
    'delete_session',
  };

  Stream<Map<String, dynamic>> get messages => _messageController.stream;
  Stream<ConnectionStatus> get statusStream => _statusController.stream;
  ConnectionStatus get status => _status;

  /// Whether the connection appears healthy (received pong recently).
  bool get isHealthy {
    if (_status != ConnectionStatus.connected) return false;
    if (_lastPongReceived == null) return true; // Haven't sent first ping yet
    return DateTime.now().difference(_lastPongReceived!) < _pongTimeout * 2;
  }

  /// Update RTT for adaptive batching thresholds.
  void updateRtt(int rttMs) {
    _currentRttMs = rttMs;
  }

  /// Update connection type for batching decisions.
  void updateConnectionType(String type) {
    _connectionType = type;
  }

  Future<void> connect(Uri uri) async {
    if (uri.toString().isEmpty) {
      throw StateError('Invalid connection URI');
    }

    // Close existing channel without triggering disconnected status
    await _channel?.sink.close();
    _channel = null;

    // Clear any pending batches on new connection
    _batchTimer?.cancel();
    _pendingBatch.clear();

    _setStatus(ConnectionStatus.connecting);
    _channel = WebSocketChannel.connect(uri);

    // Wait for the connection to be ready
    try {
      await _channel!.ready;
      _setStatus(ConnectionStatus.connected);
      _startHeartbeat();
    } catch (e) {
      _channel = null;
      _setStatus(ConnectionStatus.disconnected);
      rethrow;
    }

    _channel!.stream.listen(
      (event) {
        if (event is String) {
          _handleMessage(event);
        } else if (event is List<int>) {
          _handleMessage(utf8.decode(event));
        }
      },
      onError: (_) {
        _setStatus(ConnectionStatus.disconnected);
      },
      onDone: () {
        _setStatus(ConnectionStatus.disconnected);
      },
      cancelOnError: true,
    );
  }

  /// Send a message with optional batching based on priority.
  void send(Map<String, dynamic> message) {
    final channel = _channel;
    if (channel == null) return;

    final type = message['type'] as String? ?? '';
    final priority = _getPriority(type);

    // Immediate priority bypasses batching entirely
    if (priority == MessagePriority.immediate) {
      channel.sink.add(jsonEncode(message));
      return;
    }

    // Add to batch
    _pendingBatch.add(message);

    // Schedule batch flush if not already scheduled
    if (_batchTimer == null || !_batchTimer!.isActive) {
      final delayMs = _getBatchDelay(priority);
      _batchTimer = Timer(Duration(milliseconds: delayMs), _flushBatch);
    }
  }

  /// Send a message immediately without batching.
  void sendImmediate(Map<String, dynamic> message) {
    final channel = _channel;
    if (channel == null) return;
    channel.sink.add(jsonEncode(message));
  }

  MessagePriority _getPriority(String type) {
    if (_immediateTypes.contains(type)) {
      return MessagePriority.immediate;
    }
    if (_highPriorityTypes.contains(type)) {
      return MessagePriority.high;
    }
    return MessagePriority.normal;
  }

  int _getBatchDelay(MessagePriority priority) {
    BatchThresholds thresholds;

    // Select thresholds based on connection type and RTT
    if (_currentRttMs > 100 || _connectionType == 'highLatency') {
      thresholds = BatchThresholds.highLatency;
    } else if (_currentRttMs > 30 || _connectionType == 'tailscale') {
      thresholds = BatchThresholds.tailscale;
    } else {
      thresholds = BatchThresholds.local;
    }

    // Adjust based on priority
    switch (priority) {
      case MessagePriority.high:
        return thresholds.high;
      case MessagePriority.normal:
      case MessagePriority.low:
        return thresholds.low;
      case MessagePriority.immediate:
        return 0; // Should not reach here
    }
  }

  void _flushBatch() {
    _batchTimer = null;

    if (_pendingBatch.isEmpty) return;

    final channel = _channel;
    if (channel == null) {
      _pendingBatch.clear();
      return;
    }

    // If only one message, send it directly (no batch wrapper)
    if (_pendingBatch.length == 1) {
      channel.sink.add(jsonEncode(_pendingBatch.first));
      _pendingBatch.clear();
      return;
    }

    // Send as batch
    final batch = {
      'type': 'batch',
      'messages': List<Map<String, dynamic>>.from(_pendingBatch),
      'count': _pendingBatch.length,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    };
    channel.sink.add(jsonEncode(batch));
    _pendingBatch.clear();
  }

  Future<void> disconnect() async {
    _stopHeartbeat();
    _batchTimer?.cancel();
    _pendingBatch.clear();
    await _channel?.sink.close();
    _channel = null;
    _setStatus(ConnectionStatus.disconnected);
  }

  /// Force close the connection without graceful shutdown.
  /// Use this when the app goes to background to ensure clean state.
  void forceClose() {
    _stopHeartbeat();
    _batchTimer?.cancel();
    _pendingBatch.clear();
    _channel?.sink.close();
    _channel = null;
    _setStatus(ConnectionStatus.disconnected);
  }

  void dispose() {
    _stopHeartbeat();
    _batchTimer?.cancel();
    _messageController.close();
    _statusController.close();
  }

  /// Start heartbeat pings to detect dead connections.
  void _startHeartbeat() {
    _stopHeartbeat();
    _waitingForPong = false;
    _lastPongReceived = DateTime.now();

    _pingTimer = Timer.periodic(_pingInterval, (_) {
      if (_channel == null || _status != ConnectionStatus.connected) return;

      // If we're still waiting for a pong from the last ping, connection is dead
      if (_waitingForPong) {
        _handlePongTimeout();
        return;
      }

      // Send a ping (client-initiated, not the bridge's ping)
      _waitingForPong = true;
      final pingId = DateTime.now().millisecondsSinceEpoch.toString();
      sendImmediate({
        'type': 'client_ping',
        'id': pingId,
        'sentAt': DateTime.now().millisecondsSinceEpoch,
      });

      // Set a timeout for pong response
      _pongTimeoutTimer?.cancel();
      _pongTimeoutTimer = Timer(_pongTimeout, _handlePongTimeout);
    });
  }

  void _stopHeartbeat() {
    _pingTimer?.cancel();
    _pingTimer = null;
    _pongTimeoutTimer?.cancel();
    _pongTimeoutTimer = null;
    _waitingForPong = false;
  }

  void _handlePongTimeout() {
    // Connection is dead, force disconnect
    _stopHeartbeat();
    _channel?.sink.close();
    _channel = null;
    _setStatus(ConnectionStatus.disconnected);
  }

  /// Call this when a pong is received (either client_pong or bridge's pong).
  void _onPongReceived() {
    _waitingForPong = false;
    _lastPongReceived = DateTime.now();
    _pongTimeoutTimer?.cancel();
  }

  void _handleMessage(String raw) {
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;

      // Handle bridge heartbeat without bubbling it up to the UI.
      if (data['type'] == 'ping') {
        final payload = data['data'] as Map<String, dynamic>? ?? const {};
        final id = payload['id'] as String? ?? '';
        final sentAt = payload['sentAt'] as int? ?? 0;
        if (id.isNotEmpty && sentAt > 0) {
          // Pong is immediate priority - send directly
          sendImmediate({'type': 'pong', 'id': id, 'sentAt': sentAt});
        }
        // Bridge ping counts as proof connection is alive
        _onPongReceived();
        return;
      }

      // Handle response to our client ping
      if (data['type'] == 'client_pong') {
        _onPongReceived();
        return;
      }

      _messageController.add(data);
    } catch (_) {
      // Ignore malformed payloads.
    }
  }

  void _setStatus(ConnectionStatus status) {
    _status = status;
    _statusController.add(status);
  }
}
