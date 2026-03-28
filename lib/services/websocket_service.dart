import 'dart:async';
import 'dart:convert';

import 'package:broski/services/websocket/websocket_connector.dart';
import 'package:flutter/foundation.dart' show compute, debugPrint;
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
  StreamSubscription<dynamic>? _channelSubscription; // FIX: Track subscription
  ConnectionStatus _status = ConnectionStatus.disconnected;
  int _connectionId =
      0; // FIX: Track connection attempts for race condition prevention

  final _messageController = StreamController<Map<String, dynamic>>.broadcast();
  final _statusController = StreamController<ConnectionStatus>.broadcast();

  // Batching state
  final List<Map<String, dynamic>> _pendingBatch = [];
  Timer? _batchTimer;
  int _currentRttMs = 0;
  String _connectionType = 'unknown';

  // FIX: Queue for messages during reconnection
  final List<Map<String, dynamic>> _reconnectQueue = [];
  static const _maxQueueSize = 50; // Prevent unbounded growth
  bool _isReconnecting = false;
  bool _isHandshaking = false;

  // During the cloud-auth handshake, the bridge only accepts a very small set
  // of message types (until `auth_session_ok`). Everything else must be queued.
  static const _handshakeAllowedTypes = {'auth_session', 'client_ping', 'pong'};

  // Unified heartbeat state — a single timer handles both:
  //   1. Client ping/pong (is the network path alive?)
  //   2. Server tick watchdog (is the bridge process still running?)
  // One timer wake every 15s instead of two staggered wakes.
  Timer? _heartbeatTimer;
  Timer? _pongTimeoutTimer;
  DateTime? _lastPongReceived;
  static const _heartbeatInterval = Duration(seconds: 15);
  static const _pongTimeout = Duration(seconds: 10);
  bool _waitingForPong = false;

  // Server tick detection (bridge sends tick every 30s)
  // If we don't receive a tick in 2.5x the interval, connection is stale
  DateTime? _lastTickReceived;
  static const _expectedTickInterval = Duration(seconds: 30);
  static const _tickTimeoutMultiplier = 2.5; // 75 seconds without tick = dead

  // Incoming message decode queue (keeps ordering while allowing background
  // JSON parsing for large payloads).
  final List<String> _rawQueue = [];
  bool _isDecoding = false;
  // Safety valve: allow large dev payloads, but prevent OOM on malicious peers.
  // This is intentionally generous for "vibe coding" flows.
  static const int _maxIncomingMessageBytes = 15 * 1024 * 1024; // 15MB

  // Message types that should be sent immediately (bypass batching)
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
  bool get isHandshaking => _isHandshaking;

  /// Start gating outgoing messages (queue everything except handshake types).
  /// ConnectionProvider calls this before WS connect so early UI messages
  /// cannot race ahead of cloud auth.
  void beginHandshake() {
    _isHandshaking = true;

    // Never allow a batch to flush during handshake (a `batch` envelope is
    // allowed, but its inner messages would be processed before auth).
    _batchTimer?.cancel();
    _batchTimer = null;
    if (_pendingBatch.isNotEmpty) {
      for (final msg in _pendingBatch) {
        _queueForReconnect(msg);
      }
      _pendingBatch.clear();
    }
  }

  /// End gating and flush queued messages now that cloud auth succeeded.
  void endHandshake() {
    _isHandshaking = false;
    _flushReconnectQueue();
  }

  /// Cancel gating without flushing. Use this when the connection attempt
  /// fails before auth completes.
  void cancelHandshake() {
    _isHandshaking = false;
  }

  void clearQueuedMessages() {
    _batchTimer?.cancel();
    _batchTimer = null;
    _pendingBatch.clear();
    _reconnectQueue.clear();
  }

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

  Future<void> connect(
    Uri uri, {
    String? authToken,
    String? pinnedCertSha256,
  }) async {
    if (uri.toString().isEmpty) {
      throw StateError('Invalid connection URI');
    }

    // FIX: Increment connection ID to invalidate any in-flight operations
    final thisConnectionId = ++_connectionId;

    // FIX: Cancel existing subscription before closing channel
    await _channelSubscription?.cancel();
    _channelSubscription = null;

    // Close existing channel without triggering disconnected status
    await _channel?.sink.close();
    _channel = null;

    // Clear any pending batches on new connection
    _batchTimer?.cancel();
    _pendingBatch.clear();

    _setStatus(ConnectionStatus.connecting);
    _isReconnecting = true;
    _channel = createWebSocketChannel(
      uri,
      authToken: authToken,
      pinnedCertSha256: pinnedCertSha256,
    );

    // Wait for the connection to be ready
    try {
      debugPrint('[WebSocket] Waiting for connection ready...');
      await _channel!.ready;

      // FIX: Check if this connection attempt is still valid
      if (_connectionId != thisConnectionId) {
        // A newer connection attempt superseded us, abort
        debugPrint('[WebSocket] Connection superseded, aborting');
        _channel?.sink.close();
        return;
      }

      debugPrint('[WebSocket] Connection ready, status: connected');
      _setStatus(ConnectionStatus.connected);
      _isReconnecting = false;
      _startHeartbeat();

      // FIX: Flush any queued messages from during reconnection
      if (!_isHandshaking) {
        _flushReconnectQueue();
      }
    } catch (e) {
      debugPrint('[WebSocket] Connection failed: $e');
      if (_connectionId != thisConnectionId) return; // Superseded
      _channel = null;
      _isReconnecting = false;
      _isHandshaking = false;
      _setStatus(ConnectionStatus.disconnected);
      rethrow;
    }

    // FIX: Store subscription so we can cancel it
    _channelSubscription = _channel!.stream.listen(
      (event) {
        // FIX: Ignore events from stale connections
        if (_connectionId != thisConnectionId) return;

        if (event is String) {
          _handleMessage(event);
        } else if (event is List<int>) {
          if (event.length > _maxIncomingMessageBytes) {
            debugPrint(
              '[WebSocket] Dropping oversized message: ${event.length} bytes',
            );
            return;
          }
          _handleMessage(utf8.decode(event));
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
  }

  /// Send a message with optional batching based on priority.
  /// Returns true if sent/queued successfully, false if dropped.
  bool send(Map<String, dynamic> message) {
    final channel = _channel;
    final type = message['type'] as String? ?? '';

    // Queue while reconnecting or during handshake (except allowlisted types).
    if (channel == null ||
        _isReconnecting ||
        (_isHandshaking && !_handshakeAllowedTypes.contains(type))) {
      return _queueForReconnect(message);
    }

    final priority = _getPriority(type);

    // Immediate priority bypasses batching entirely
    if (priority == MessagePriority.immediate) {
      channel.sink.add(jsonEncode(message));
      return true;
    }

    // Add to batch
    _pendingBatch.add(message);

    // Schedule batch flush if not already scheduled
    if (_batchTimer == null || !_batchTimer!.isActive) {
      final delayMs = _getBatchDelay(priority);
      _batchTimer = Timer(Duration(milliseconds: delayMs), _flushBatch);
    }
    return true;
  }

  /// Send a message immediately without batching.
  /// Returns true if sent successfully, false if queued or dropped.
  bool sendImmediate(Map<String, dynamic> message) {
    final channel = _channel;
    final type = message['type'] as String? ?? '';

    // Queue during reconnection or handshake (except allowlisted types).
    if (channel == null ||
        _isReconnecting ||
        (_isHandshaking && !_handshakeAllowedTypes.contains(type))) {
      return _queueForReconnect(message);
    }

    channel.sink.add(jsonEncode(message));
    return true;
  }

  /// Queue a message to be sent after reconnection.
  bool _queueForReconnect(Map<String, dynamic> message) {
    final type = message['type'] as String? ?? '';

    // Don't queue low-value messages
    if (type == 'client_ping' || type == 'pong') {
      return false;
    }

    // Prevent unbounded queue growth
    if (_reconnectQueue.length >= _maxQueueSize) {
      // Remove oldest non-critical message
      _reconnectQueue.removeAt(0);
    }

    _reconnectQueue.add(message);
    return true;
  }

  /// Flush queued messages after successful reconnection.
  void _flushReconnectQueue() {
    if (_reconnectQueue.isEmpty) return;

    final channel = _channel;
    if (channel == null) return;

    // Send all queued messages
    for (final message in _reconnectQueue) {
      channel.sink.add(jsonEncode(message));
    }
    _reconnectQueue.clear();
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
    if (channel == null || _isReconnecting) {
      // FIX: Queue batched messages instead of dropping
      for (final msg in _pendingBatch) {
        _queueForReconnect(msg);
      }
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
    _connectionId++; // Invalidate any in-flight operations
    _stopHeartbeat();
    _batchTimer?.cancel();
    _pendingBatch.clear();
    _reconnectQueue.clear(); // Clear queue on intentional disconnect
    await _channelSubscription?.cancel();
    _channelSubscription = null;
    await _channel?.sink.close();
    _channel = null;
    _isReconnecting = false;
    _isHandshaking = false;
    _setStatus(ConnectionStatus.disconnected);
  }

  /// Force close the connection without graceful shutdown.
  /// Use this when the app goes to background to ensure clean state.
  void forceClose() {
    _connectionId++; // Invalidate any in-flight operations
    _stopHeartbeat();
    _batchTimer?.cancel();
    _pendingBatch.clear();
    // Keep reconnect queue - we might want these after foregrounding
    _channelSubscription?.cancel();
    _channelSubscription = null;
    _channel?.sink.close();
    _channel = null;
    _isReconnecting = false;
    _isHandshaking = false;
    _setStatus(ConnectionStatus.disconnected);
  }

  void dispose() {
    _connectionId++; // Invalidate any in-flight operations
    _stopHeartbeat();
    _batchTimer?.cancel();
    _pendingBatch.clear();
    _reconnectQueue.clear();
    _channelSubscription?.cancel();
    _channelSubscription = null;
    _channel?.sink.close(); // FIX: Close the channel on dispose
    _channel = null;
    _messageController.close();
    _statusController.close();
  }

  /// Start the unified heartbeat timer.
  ///
  /// A single [Timer.periodic] at 15 s handles two checks:
  ///   1. **Ping/pong** — sends a client_ping and expects a client_pong back
  ///      within [_pongTimeout]. If the previous pong never arrived, the
  ///      connection is declared dead.
  ///   2. **Tick watchdog** — the bridge sends a `tick` every 30 s. If we
  ///      haven't received one in 2.5× that interval (75 s), the bridge
  ///      probably restarted or the Mac went to sleep.
  ///
  /// Merging into one timer halves the CPU wake frequency compared to running
  /// two independent periodic timers, which helps battery on mobile.
  void _startHeartbeat() {
    _stopHeartbeat();
    _waitingForPong = false;
    _lastPongReceived = DateTime.now();
    _lastTickReceived = DateTime.now();

    _heartbeatTimer = Timer.periodic(_heartbeatInterval, (_) {
      if (_channel == null || _status != ConnectionStatus.connected) return;

      // ── Check 1: Ping/pong liveness ──
      if (_waitingForPong) {
        _handlePongTimeout();
        return;
      }

      _waitingForPong = true;
      final pingId = DateTime.now().millisecondsSinceEpoch.toString();
      sendImmediate({
        'type': 'client_ping',
        'id': pingId,
        'sentAt': DateTime.now().millisecondsSinceEpoch,
      });

      _pongTimeoutTimer?.cancel();
      _pongTimeoutTimer = Timer(_pongTimeout, _handlePongTimeout);

      // ── Check 2: Server tick watchdog ──
      if (_lastTickReceived != null) {
        final timeSinceTick = DateTime.now().difference(_lastTickReceived!);
        final timeoutThreshold = Duration(
          milliseconds:
              (_expectedTickInterval.inMilliseconds * _tickTimeoutMultiplier)
                  .round(),
        );
        if (timeSinceTick > timeoutThreshold) {
          debugPrint(
            '[WebSocket] Tick timeout: ${timeSinceTick.inSeconds}s since last tick (threshold: ${timeoutThreshold.inSeconds}s)',
          );
          _handleTickTimeout();
        }
      }
    });
  }

  void _stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _pongTimeoutTimer?.cancel();
    _pongTimeoutTimer = null;
    _waitingForPong = false;
  }

  void _handlePongTimeout() {
    debugPrint('[WebSocket] Pong timeout - forcing disconnect');
    // Connection is dead, force disconnect
    _stopHeartbeat();
    _channel?.sink.close();
    _channel = null;
    _setStatus(ConnectionStatus.disconnected);
  }

  void _handleTickTimeout() {
    debugPrint(
      '[WebSocket] Server tick timeout - connection stale, forcing disconnect',
    );
    // Server stopped sending ticks - bridge probably restarted or Mac woke up
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

  /// Call this when a server tick is received.
  void _onTickReceived() {
    _lastTickReceived = DateTime.now();
  }

  static Map<String, dynamic> _decodeJsonMap(String raw) {
    final decoded = jsonDecode(raw);
    return decoded is Map<String, dynamic> ? decoded : <String, dynamic>{};
  }

  void _handleMessage(String raw) {
    // Approximate bytes (UTF-16 code units). We keep this cheap; exact byte
    // counting would allocate (utf8.encode).
    if (raw.length > _maxIncomingMessageBytes) {
      debugPrint('[WebSocket] Dropping oversized message: ${raw.length} chars');
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
        final raw = _rawQueue.removeAt(0);

        final Map<String, dynamic> data;
        if (raw.length > 4096) {
          // Offload large payload parsing to a background isolate.
          data = await compute(_decodeJsonMap, raw);
        } else {
          data = _decodeJsonMap(raw);
        }

        if (data.isEmpty) continue;

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
          continue;
        }

        // Handle response to our client ping
        if (data['type'] == 'client_pong') {
          _onPongReceived();
          continue;
        }

        // Handle server tick (liveness signal from bridge)
        // Bridge sends tick every 30s - if we receive it, connection is healthy.
        // Tick timeout is handled by _tickWatchdogTimer.
        if (data['type'] == 'tick') {
          _onTickReceived();
          // Also counts as pong (any server message proves liveness)
          _onPongReceived();
          continue;
        }

        _messageController.add(data);
      }
    } catch (_) {
      // Malformed payloads should not crash the app; log for visibility.
      debugPrint('[WebSocket] Dropped malformed payload');
    } finally {
      _isDecoding = false;
    }
  }

  void _setStatus(ConnectionStatus status) {
    _status = status;
    _statusController.add(status);
  }
}
