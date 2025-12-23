import 'dart:async';

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
  });

  final ConnectionInfo? connection;
  final ConnectionStatus status;
  final String? error;
  final bool opencodeRunning;

  bool get isConnected => status == ConnectionStatus.connected;
  bool get isConnecting => status == ConnectionStatus.connecting;

  BridgeConnectionState copyWith({
    ConnectionInfo? connection,
    ConnectionStatus? status,
    String? error,
    bool? opencodeRunning,
  }) {
    return BridgeConnectionState(
      connection: connection ?? this.connection,
      status: status ?? this.status,
      error: error,
      opencodeRunning: opencodeRunning ?? this.opencodeRunning,
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
    );

    try {
      await _socket.connect(info.toWebSocketUri());
      await _storage.saveConnection(info);
      _reconnectAttempts = 0;
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
    state = state.copyWith(connection: null);
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
  }

  void _scheduleReconnect() {
    if (state.connection == null) return;
    if (_reconnectTimer?.isActive ?? false) return;

    final delaySeconds = (_reconnectAttempts == 0 ? 2 : 2 << _reconnectAttempts)
        .clamp(2, 30);
    _reconnectAttempts += 1;

    _reconnectTimer = Timer(Duration(seconds: delaySeconds), () {
      final connection = state.connection;
      if (connection != null) {
        connect(connection);
      }
    });
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
