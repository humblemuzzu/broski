import 'dart:async';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/connection.dart';
import '../models/connection_quality.dart';
import '../services/network_monitor_service.dart';
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
    this.connectionType = ConnectionType.unknown,
    this.connectedHost,
  });

  final ConnectionInfo? connection;
  final ConnectionStatus status;
  final String? error;
  final bool opencodeRunning;
  final bool isReconnecting;
  final int? rttMs;
  final ConnectionType connectionType;
  final String? connectedHost;

  /// When true, the app operates in read-only mode using cached data.
  /// User can browse projects, sessions, and messages but cannot send new messages.
  final bool isOfflineMode;

  bool get isConnected => status == ConnectionStatus.connected;
  bool get isConnecting => status == ConnectionStatus.connecting;

  String get connectionDescription {
    if (!isConnected) return 'Disconnected';

    switch (connectionType) {
      case ConnectionType.local:
        return 'Local • ${rttMs ?? 0}ms';
      case ConnectionType.tailscale:
        return 'Tailscale • ${rttMs ?? 0}ms';
      case ConnectionType.magicDNS:
        return 'MagicDNS • ${rttMs ?? 0}ms';
      case ConnectionType.unknown:
        return 'Connected • ${rttMs ?? 0}ms';
    }
  }

  BridgeConnectionState copyWith({
    ConnectionInfo? connection,
    bool clearConnection = false,
    ConnectionStatus? status,
    String? error,
    bool? opencodeRunning,
    bool? isReconnecting,
    int? rttMs,
    bool? isOfflineMode,
    ConnectionType? connectionType,
    String? connectedHost,
  }) {
    return BridgeConnectionState(
      connection: clearConnection ? null : (connection ?? this.connection),
      status: status ?? this.status,
      error: error,
      opencodeRunning: opencodeRunning ?? this.opencodeRunning,
      isReconnecting: isReconnecting ?? this.isReconnecting,
      rttMs: rttMs ?? this.rttMs,
      isOfflineMode: isOfflineMode ?? this.isOfflineMode,
      connectionType: connectionType ?? this.connectionType,
      connectedHost: connectedHost ?? this.connectedHost,
    );
  }
}

enum ReconnectionStrategy {
  quickRecovery(
    timeout: Duration(seconds: 2),
    delay: Duration(milliseconds: 500),
  ),
  normal(timeout: Duration(seconds: 5), delay: Duration(seconds: 2)),
  slowRecovery(timeout: Duration(seconds: 10), delay: Duration(seconds: 30));

  const ReconnectionStrategy({required this.timeout, required this.delay});

  final Duration timeout;
  final Duration delay;
}

class ConnectionNotifier extends StateNotifier<BridgeConnectionState> {
  ConnectionNotifier(this._storage, this._socket, this._networkMonitor)
    : super(const BridgeConnectionState()) {
    _statusSub = _socket.statusStream.listen(_handleStatus);
    _messageSub = _socket.messages.listen(_handleMessage);
    _networkSub = _networkMonitor.stateStream.listen(_handleNetworkChange);
    _loadSavedConnection();
  }

  final StorageService _storage;
  final WebSocketService _socket;
  final NetworkMonitorService _networkMonitor;

  StreamSubscription<ConnectionStatus>? _statusSub;
  StreamSubscription<Map<String, dynamic>>? _messageSub;
  StreamSubscription<NetworkState>? _networkSub;
  Timer? _reconnectTimer;
  int _reconnectAttempts = 0;
  int _failureStreak = 0;
  bool _isConnecting = false;
  final _random = Random();

  DateTime? _lastSuccessfulConnection;
  ConnectionType? _lastSuccessfulType;

  Future<void> _loadSavedConnection() async {
    final saved = await _storage.loadConnection();
    if (saved != null) {
      await connect(saved);
    }
  }

  Future<void> connect(
    ConnectionInfo info, {
    ConnectionType? preferredType,
  }) async {
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
      final uri = _getConnectionUri(info, preferredType);
      await _socket.connect(uri);
      await _storage.saveConnection(info);
      _reconnectAttempts = 0;
      _failureStreak = 0;

      final connectedHost = uri.host;
      final connectionType = _detectConnectionType(info, connectedHost);

      _lastSuccessfulConnection = DateTime.now();
      _lastSuccessfulType = connectionType;

      state = state.copyWith(
        isReconnecting: false,
        error: null,
        connectionType: connectionType,
        connectedHost: connectedHost,
      );
    } catch (error) {
      _failureStreak++;
      state = state.copyWith(
        status: ConnectionStatus.disconnected,
        error: '$error',
      );
      _scheduleSmartReconnect();
    } finally {
      _isConnecting = false;
    }
  }

  Uri _getConnectionUri(ConnectionInfo info, ConnectionType? preferredType) {
    if (preferredType == ConnectionType.local && info.localIP != null) {
      return Uri.parse('ws://${info.localIP}:${info.port}');
    }
    if (preferredType == ConnectionType.tailscale && info.tailscaleIP != null) {
      return Uri.parse('ws://${info.tailscaleIP}:${info.port}');
    }
    if (preferredType == ConnectionType.magicDNS &&
        info.magicDNSHostname != null) {
      return Uri.parse('ws://${info.magicDNSHostname}:${info.port}');
    }
    return info.toWebSocketUri();
  }

  ConnectionType _detectConnectionType(
    ConnectionInfo info,
    String? connectedHost,
  ) {
    if (connectedHost == null) return ConnectionType.unknown;

    if (info.localIP != null && connectedHost == info.localIP) {
      return ConnectionType.local;
    }

    if (info.tailscaleIP != null && connectedHost == info.tailscaleIP) {
      return ConnectionType.tailscale;
    }

    if (info.magicDNSHostname != null &&
        connectedHost == info.magicDNSHostname) {
      return ConnectionType.magicDNS;
    }

    // Check for Tailscale IP prefix (100.x.x.x)
    if (connectedHost.startsWith('100.')) {
      return ConnectionType.tailscale;
    }

    return ConnectionType.unknown;
  }

  Future<void> disconnect() async {
    _reconnectTimer?.cancel();
    await _socket.disconnect();
    state = state.copyWith(status: ConnectionStatus.disconnected);
  }

  Future<void> clearConnection() async {
    // Cancel any pending reconnect first
    _reconnectTimer?.cancel();
    _reconnectAttempts = 0;
    _failureStreak = 0;

    // Clear connection state BEFORE disconnecting to prevent
    // _handleStatus from scheduling a reconnect
    await _storage.clearConnection();
    state = state.copyWith(
      clearConnection: true,
      status: ConnectionStatus.disconnected,
      isOfflineMode: false,
      isReconnecting: false,
    );

    // Now disconnect the socket
    await _socket.disconnect();
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

  /// Handle network state changes from connectivity_plus.
  /// Triggers immediate reconnection when network comes back online.
  void _handleNetworkChange(NetworkState networkState) {
    final hasNetwork =
        networkState != NetworkState.none &&
        networkState != NetworkState.unknown;

    // If we just got network back and we're disconnected, try to reconnect immediately
    if (hasNetwork &&
        state.connection != null &&
        state.status == ConnectionStatus.disconnected &&
        !_isConnecting) {
      // Reset failure streak since network change is a fresh start
      _failureStreak = 0;
      _reconnectAttempts = 0;

      // Cancel any pending reconnect timer
      _reconnectTimer?.cancel();

      // Determine preferred connection type based on network state
      ConnectionType? preferredType;
      if (networkState == NetworkState.vpn) {
        // VPN likely means Tailscale, try tailscale/magicDNS first
        preferredType = _lastSuccessfulType ?? ConnectionType.tailscale;
      } else if (networkState == NetworkState.wifi ||
          networkState == NetworkState.ethernet) {
        // Local network, try local first
        preferredType = ConnectionType.local;
      }

      // Reconnect with short delay to let network stabilize
      _reconnectTimer = Timer(const Duration(milliseconds: 500), () {
        final connection = state.connection;
        if (connection != null) {
          connect(connection, preferredType: preferredType);
        }
      });
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

  /// Smart reconnection that adapts strategy based on failure patterns.
  /// Uses last successful connection type and adjusts delays based on streak.
  void _scheduleSmartReconnect() {
    if (state.connection == null) return;
    if (_reconnectTimer?.isActive ?? false) return;

    final strategy = _determineReconnectionStrategy();
    _reconnectAttempts += 1;

    state = state.copyWith(isReconnecting: true);

    // Add jitter to prevent thundering herd
    final jitterMs = (_random.nextDouble() * 500).round();
    final delayMs = strategy.delay.inMilliseconds + jitterMs;

    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      final connection = state.connection;
      if (connection != null) {
        // Try last successful connection type first if available
        connect(connection, preferredType: _lastSuccessfulType);
      }
    });
  }

  ReconnectionStrategy _determineReconnectionStrategy() {
    // If we had a recent success (within 30s), use quick recovery
    if (_lastSuccessfulConnection != null) {
      final timeSinceSuccess = DateTime.now().difference(
        _lastSuccessfulConnection!,
      );
      if (timeSinceSuccess.inSeconds < 30 && _failureStreak < 3) {
        return ReconnectionStrategy.quickRecovery;
      }
    }

    // Based on failure streak
    if (_failureStreak < 3) {
      return ReconnectionStrategy.quickRecovery;
    } else if (_failureStreak < 6) {
      return ReconnectionStrategy.normal;
    } else {
      return ReconnectionStrategy.slowRecovery;
    }
  }

  @override
  void dispose() {
    _statusSub?.cancel();
    _messageSub?.cancel();
    _networkSub?.cancel();
    _reconnectTimer?.cancel();
    super.dispose();
  }
}

final connectionProvider =
    StateNotifierProvider<ConnectionNotifier, BridgeConnectionState>((ref) {
      final storage = ref.watch(storageServiceProvider);
      final socket = ref.watch(webSocketServiceProvider);
      final networkMonitor = ref.watch(networkMonitorServiceProvider);
      return ConnectionNotifier(storage, socket, networkMonitor);
    });
