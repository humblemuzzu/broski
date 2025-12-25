import 'dart:async';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/connection.dart';
import '../services/storage_service.dart';
import '../services/websocket_service.dart';
import 'service_providers.dart';

class BridgeConnectionState {
  const BridgeConnectionState({
    this.connection,
    this.status = ConnectionStatus.disconnected,
    this.error,
    this.opencodeRunning = true,
    this.isReconnecting = false,
    this.rttMs,
    this.isOfflineMode = false,
  });

  final ConnectionInfo? connection;
  final ConnectionStatus status;
  final String? error;
  final bool opencodeRunning;
  final bool isReconnecting;
  final int? rttMs;

  /// When true, the app operates in read-only mode using cached data.
  /// User can browse projects, sessions, and messages but cannot send new messages.
  final bool isOfflineMode;

  bool get isConnected => status == ConnectionStatus.connected;
  bool get isConnecting => status == ConnectionStatus.connecting;

  BridgeConnectionState copyWith({
    ConnectionInfo? connection,
    bool clearConnection = false,
    ConnectionStatus? status,
    String? error,
    bool? opencodeRunning,
    bool? isReconnecting,
    int? rttMs,
    bool? isOfflineMode,
  }) {
    return BridgeConnectionState(
      connection: clearConnection ? null : (connection ?? this.connection),
      status: status ?? this.status,
      error: error,
      opencodeRunning: opencodeRunning ?? this.opencodeRunning,
      isReconnecting: isReconnecting ?? this.isReconnecting,
      rttMs: rttMs ?? this.rttMs,
      isOfflineMode: isOfflineMode ?? this.isOfflineMode,
    );
  }
}

class ConnectionNotifier extends StateNotifier<BridgeConnectionState> {
  ConnectionNotifier(this._storage, this._socket)
    : super(const BridgeConnectionState()) {
    _statusSub = _socket.statusStream.listen(_handleStatus);
    _messageSub = _socket.messages.listen(_handleMessage);
    _loadSavedConnection();
  }

  final StorageService _storage;
  final WebSocketService _socket;

  StreamSubscription<ConnectionStatus>? _statusSub;
  StreamSubscription<Map<String, dynamic>>? _messageSub;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  bool _isConnecting = false;
  final _random = Random();

  Future<void> _loadSavedConnection() async {
    final saved = await _storage.loadConnection();
    if (saved != null) {
      await connect(saved);
    }
  }

  Future<void> connect(ConnectionInfo info) async {
    if (_isConnecting) return;
    _isConnecting = true;
    _reconnectTimer?.cancel();
    state = state.copyWith(
      connection: info,
      status: ConnectionStatus.connecting,
      error: null,
      isReconnecting: _reconnectAttempts > 0,
    );

    try {
      await _socket.connect(info.toWebSocketUri());
      await _storage.saveConnection(info);
      _reconnectAttempts = 0;
      state = state.copyWith(isReconnecting: false, error: null);
      // Status is set by the socket's status stream listener
    } catch (error) {
      state = state.copyWith(
        status: ConnectionStatus.disconnected,
        error: '$error',
      );
      _scheduleReconnect();
    } finally {
      _isConnecting = false;
    }
  }

  Future<void> disconnect() async {
    _reconnectTimer?.cancel();
    await _socket.disconnect();
    state = state.copyWith(status: ConnectionStatus.disconnected);
  }

  Future<void> clearConnection() async {
    await disconnect();
    await _storage.clearConnection();
    state = state.copyWith(clearConnection: true, isOfflineMode: false);
  }

  /// Enter offline/preview mode - allows browsing cached data without connection
  void enterOfflineMode() {
    _reconnectTimer?.cancel();
    state = state.copyWith(isOfflineMode: true);
  }

  /// Exit offline mode
  void exitOfflineMode() {
    state = state.copyWith(isOfflineMode: false);
    // Try to reconnect if we have a saved connection
    final connection = state.connection;
    if (connection != null) {
      connect(connection);
    }
  }

  void _handleStatus(ConnectionStatus status) {
    // Only schedule reconnect if we unexpectedly disconnected (not during intentional reconnect)
    if (status == ConnectionStatus.disconnected &&
        state.connection != null &&
        !_isConnecting) {
      _scheduleReconnect();
    }

    state = state.copyWith(status: status);
  }

  void _handleMessage(Map<String, dynamic> message) {
    if (message['type'] == 'status') {
      final data = message['data'] as Map<String, dynamic>? ?? const {};
      final running = data['opencodeRunning'] == true;
      state = state.copyWith(opencodeRunning: running);
    }

    if (message['type'] == 'connection_metrics') {
      final data = message['data'] as Map<String, dynamic>? ?? const {};
      final rtt = data['rttMs'];
      if (rtt is int) {
        state = state.copyWith(rttMs: rtt);
      }
    }
  }

  void _scheduleReconnect() {
    if (state.connection == null) return;
    if (_reconnectTimer?.isActive ?? false) return;

    final baseDelaySeconds = min(30, pow(2, min(_reconnectAttempts, 4)) * 2);
    final jitter = _random.nextDouble(); // 0-1s jitter to avoid thundering herd
    final delaySeconds = (baseDelaySeconds + jitter).clamp(2, 30).toDouble();
    _reconnectAttempts += 1;

    state = state.copyWith(isReconnecting: true);

    _reconnectTimer = Timer(
      Duration(milliseconds: (delaySeconds * 1000).round()),
      () {
        final connection = state.connection;
        if (connection != null) {
          connect(connection);
        }
      },
    );
  }

  @override
  void dispose() {
    _statusSub?.cancel();
    _messageSub?.cancel();
    _reconnectTimer?.cancel();
    super.dispose();
  }
}

final connectionProvider =
    StateNotifierProvider<ConnectionNotifier, BridgeConnectionState>((ref) {
      final storage = ref.watch(storageServiceProvider);
      final socket = ref.watch(webSocketServiceProvider);
      return ConnectionNotifier(storage, socket);
    });
