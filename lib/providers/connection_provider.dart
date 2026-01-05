import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/connection.dart';
import '../models/connection_quality.dart';
import '../models/device.dart';
import '../services/bridge_service.dart';
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
    this.thisDevice,
    this.connectedDevices = const [],
  });

  final ConnectionInfo? connection;
  final ConnectionStatus status;
  final String? error;
  final bool opencodeRunning;
  final bool isReconnecting;
  final int? rttMs;
  final ConnectionType connectionType;
  final String? connectedHost;

  final DeviceInfo? thisDevice;
  final List<DeviceInfo> connectedDevices;

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
      case ConnectionType.hotspot:
        return 'Hotspot • ${rttMs ?? 0}ms';
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
    DeviceInfo? thisDevice,
    List<DeviceInfo>? connectedDevices,
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
      thisDevice: thisDevice ?? this.thisDevice,
      connectedDevices: connectedDevices ?? this.connectedDevices,
    );
  }

  int get otherDevicesCount {
    if (thisDevice == null) return connectedDevices.length;
    return connectedDevices
        .where((d) => d.deviceId != thisDevice!.deviceId)
        .length;
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

/// Result of a connection attempt to a specific endpoint.
class _ConnectionResult {
  final ConnectionType type;
  final Uri uri;
  final String host;
  final bool success;
  final Object? error;

  _ConnectionResult({
    required this.type,
    required this.uri,
    required this.host,
    required this.success,
    this.error,
  });
}

class ConnectionNotifier extends StateNotifier<BridgeConnectionState>
    with WidgetsBindingObserver {
  ConnectionNotifier(
    this._storage,
    this._socket,
    this._networkMonitor,
    this._bridge,
  ) : super(const BridgeConnectionState()) {
    _statusSub = _socket.statusStream.listen(_handleStatus);
    _messageSub = _socket.messages.listen(_handleMessage);
    _networkSub = _networkMonitor.stateStream.listen(_handleNetworkChange);
    _loadSavedConnection();

    // Register for app lifecycle events
    WidgetsBinding.instance.addObserver(this);
  }

  final StorageService _storage;
  final WebSocketService _socket;
  final NetworkMonitorService _networkMonitor;
  final BridgeService _bridge;

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

  // Message deduplication cache
  final Map<String, DateTime> _sentMessages = {};
  static const _dedupeTtl = Duration(seconds: 5);
  static const _maxDedupeEntries = 500;

  // Device info
  String? _deviceId;
  String? _deviceName;

  // App lifecycle tracking
  bool _wasBackgrounded = false;
  DateTime? _backgroundedAt;

  Future<void> _loadSavedConnection() async {
    final saved = await _storage.loadConnection();
    if (saved != null) {
      debugPrint('[Connection] Loading saved connection:');
      debugPrint('  - localIP: ${saved.localIP}');
      debugPrint('  - tailscaleIP: ${saved.tailscaleIP}');
      debugPrint('  - port: ${saved.port}');
      debugPrint('  - hasAuthToken: ${saved.authToken != null}');
      debugPrint(
        '  - tokenPrefix: ${saved.authToken?.substring(0, 4) ?? "null"}...',
      );
      await connect(saved);
    } else {
      debugPrint('[Connection] No saved connection found');
    }
  }

  Future<void> _registerThisDevice() async {
    _deviceId = await _storage.getOrCreateDeviceId();
    _deviceName = _getDeviceName();
    final platform = _getPlatformName();

    _bridge.registerDevice(
      deviceId: _deviceId!,
      deviceName: _deviceName!,
      platform: platform,
    );
  }

  String _getDeviceName() {
    if (Platform.isIOS) return 'iPhone';
    if (Platform.isAndroid) return 'Android';
    if (Platform.isMacOS) return 'Mac';
    if (Platform.isWindows) return 'Windows';
    if (Platform.isLinux) return 'Linux';
    return 'Unknown Device';
  }

  String _getPlatformName() {
    if (Platform.isIOS) return 'ios';
    if (Platform.isAndroid) return 'android';
    if (Platform.isMacOS) return 'macos';
    if (Platform.isWindows) return 'windows';
    if (Platform.isLinux) return 'linux';
    return 'unknown';
  }

  Future<List<DeviceInfo>> listDevices() async {
    return _bridge.listDevices();
  }

  void disconnectDevice(String deviceId) {
    _bridge.disconnectDevice(deviceId);
  }

  /// Connect to the bridge using concurrent multi-endpoint failover.
  /// Tries all available endpoints simultaneously and uses the first successful one.
  Future<void> connect(
    ConnectionInfo info, {
    ConnectionType? preferredType,
  }) async {
    if (_isConnecting) return;
    _isConnecting = true;
    _reconnectTimer?.cancel();

    // Clear dedupe cache on new connection
    _sentMessages.clear();

    state = state.copyWith(
      connection: info,
      status: ConnectionStatus.connecting,
      error: null,
      isReconnecting: _reconnectAttempts > 0,
    );

    try {
      // Build list of endpoints to try
      final endpoints = _buildEndpointsToTry(info, preferredType);

      if (endpoints.isEmpty) {
        throw StateError('No valid endpoints available');
      }

      // Try all endpoints concurrently (first success wins)
      final result = await _tryConnectConcurrent(endpoints);

      if (result == null || !result.success) {
        throw StateError(
          result?.error?.toString() ?? 'All connection attempts failed',
        );
      }

      await _storage.saveConnection(info);
      _reconnectAttempts = 0;
      _failureStreak = 0;

      _lastSuccessfulConnection = DateTime.now();
      _lastSuccessfulType = result.type;

      // Update WebSocket service with connection info for batching
      _socket.updateConnectionType(_connectionTypeToString(result.type));

      state = state.copyWith(
        isReconnecting: false,
        error: null,
        connectionType: result.type,
        connectedHost: result.host,
      );

      await _registerThisDevice();
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

  /// Build list of endpoints to try, ordered by preference.
  List<({ConnectionType type, Uri uri, String host})> _buildEndpointsToTry(
    ConnectionInfo info,
    ConnectionType? preferredType,
  ) {
    final endpoints = <({ConnectionType type, Uri uri, String host})>[];

    void addEndpoint(
      ConnectionType type,
      String? host, {
      bool isSecure = false,
    }) {
      if (host == null || host.isEmpty) return;

      final scheme = isSecure ? 'wss' : 'ws';
      final baseUri = Uri.parse('$scheme://$host:${info.port}');
      final uri = info.authToken != null
          ? baseUri.replace(queryParameters: {'token': info.authToken!})
          : baseUri;
      endpoints.add((type: type, uri: uri, host: host));
    }

    // If preferred type specified, add it first
    if (preferredType != null) {
      switch (preferredType) {
        case ConnectionType.local:
          addEndpoint(ConnectionType.local, info.localIP);
        case ConnectionType.hotspot:
          addEndpoint(ConnectionType.hotspot, info.hotspotIP);
        case ConnectionType.tailscale:
          addEndpoint(ConnectionType.tailscale, info.tailscaleIP);
        case ConnectionType.magicDNS:
          addEndpoint(ConnectionType.magicDNS, info.magicDNSHostname);
        case ConnectionType.unknown:
          break;
      }
    }

    // Add all endpoints (if not already added as preferred)
    if (preferredType != ConnectionType.local && info.localIP != null) {
      addEndpoint(ConnectionType.local, info.localIP);
    }
    if (preferredType != ConnectionType.hotspot && info.hotspotIP != null) {
      addEndpoint(ConnectionType.hotspot, info.hotspotIP);
    }
    if (preferredType != ConnectionType.tailscale && info.tailscaleIP != null) {
      addEndpoint(ConnectionType.tailscale, info.tailscaleIP);
    }
    if (preferredType != ConnectionType.magicDNS &&
        info.magicDNSHostname != null) {
      addEndpoint(ConnectionType.magicDNS, info.magicDNSHostname);
    }

    if (info.funnelURL != null && info.funnelURL!.isNotEmpty) {
      final funnelWss = info.funnelURL!.replaceFirst('https://', 'wss://');
      final baseFunnelUri = Uri.parse(funnelWss);
      final funnelUri = info.authToken != null
          ? baseFunnelUri.replace(queryParameters: {'token': info.authToken!})
          : baseFunnelUri;
      endpoints.add((
        type: ConnectionType.unknown,
        uri: funnelUri,
        host: funnelUri.host,
      ));
    }

    return endpoints;
  }

  Future<_ConnectionResult?> _tryConnectConcurrent(
    List<({ConnectionType type, Uri uri, String host})> endpoints,
  ) async {
    if (endpoints.isEmpty) return null;

    Object? lastError;

    for (final ep in endpoints) {
      // Debug: Log connection attempt (strip token for security)
      final debugUri = ep.uri.replace(queryParameters: {'token': '***'});
      debugPrint('[Connection] Trying ${ep.type.name}: $debugUri');

      try {
        await _socket
            .connect(ep.uri)
            .timeout(
              const Duration(seconds: 3),
              onTimeout: () => throw TimeoutException('Connection timeout'),
            );
        debugPrint('[Connection] SUCCESS: Connected via ${ep.type.name}');
        return _ConnectionResult(
          type: ep.type,
          uri: ep.uri,
          host: ep.host,
          success: true,
        );
      } catch (e) {
        debugPrint('[Connection] FAILED ${ep.type.name}: $e');
        lastError = e;
      }
    }

    final lastEp = endpoints.last;
    return _ConnectionResult(
      type: lastEp.type,
      uri: lastEp.uri,
      host: lastEp.host,
      success: false,
      error: lastError,
    );
  }

  /// Try to connect to a single endpoint with timeout.
  Future<_ConnectionResult> _tryConnectSingle(
    ({ConnectionType type, Uri uri, String host}) endpoint,
  ) async {
    try {
      await _socket
          .connect(endpoint.uri)
          .timeout(
            const Duration(seconds: 5),
            onTimeout: () => throw TimeoutException('Connection timeout'),
          );
      return _ConnectionResult(
        type: endpoint.type,
        uri: endpoint.uri,
        host: endpoint.host,
        success: true,
      );
    } catch (e) {
      return _ConnectionResult(
        type: endpoint.type,
        uri: endpoint.uri,
        host: endpoint.host,
        success: false,
        error: e,
      );
    }
  }

  String _connectionTypeToString(ConnectionType type) {
    switch (type) {
      case ConnectionType.local:
        return 'local';
      case ConnectionType.hotspot:
        return 'hotspot';
      case ConnectionType.tailscale:
      case ConnectionType.magicDNS:
        return 'tailscale';
      case ConnectionType.unknown:
        return 'unknown';
    }
  }

  /// Send a message with deduplication support.
  /// Returns true if message was sent, false if it was a duplicate.
  bool sendWithDedupe(Map<String, dynamic> message) {
    final key = _generateIdempotencyKey(message);
    final now = DateTime.now();

    // Check if recently sent
    final lastSent = _sentMessages[key];
    if (lastSent != null && now.difference(lastSent) < _dedupeTtl) {
      // Duplicate detected, skip sending
      return false;
    }

    // Mark as sent
    _sentMessages[key] = now;

    // Send via socket
    _socket.send(message);

    // Cleanup old entries periodically
    _cleanupDedupeCache();

    return true;
  }

  String _generateIdempotencyKey(Map<String, dynamic> message) {
    final type = message['type'] as String? ?? '';
    final sessionId = message['sessionId'] as String?;
    final requestId = message['requestId'] as String?;

    // For messages with requestId, use that as the key
    if (requestId != null) {
      return '$type:$requestId';
    }

    // For chat messages, include content hash
    if (type == 'chat') {
      final content = message['content'] as String? ?? '';
      return '$type:$sessionId:${content.hashCode}';
    }

    // For other messages, use type + sessionId
    if (sessionId != null) {
      return '$type:$sessionId';
    }

    return '$type:${message.hashCode}';
  }

  void _cleanupDedupeCache() {
    if (_sentMessages.length <= _maxDedupeEntries) return;

    final now = DateTime.now();
    final expiredKeys = <String>[];

    for (final entry in _sentMessages.entries) {
      if (now.difference(entry.value) > _dedupeTtl) {
        expiredKeys.add(entry.key);
      }
    }

    for (final key in expiredKeys) {
      _sentMessages.remove(key);
    }

    // If still too many, remove oldest
    if (_sentMessages.length > _maxDedupeEntries) {
      final sorted = _sentMessages.entries.toList()
        ..sort((a, b) => a.value.compareTo(b.value));

      final toRemove = sorted.length - _maxDedupeEntries;
      for (var i = 0; i < toRemove; i++) {
        _sentMessages.remove(sorted[i].key);
      }
    }
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
    _sentMessages.clear();

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
        _socket.updateRtt(rtt);
      }
      final connType = data['connectionType'] as String?;
      if (connType != null) {
        _socket.updateConnectionType(connType);
      }
    }

    if (message['type'] == 'device_registered') {
      final data = message['data'] as Map<String, dynamic>? ?? const {};
      final device = DeviceInfo.fromJson(data);
      state = state.copyWith(thisDevice: device);
    }

    if (message['type'] == 'device_connected') {
      final data = message['data'] as Map<String, dynamic>? ?? const {};
      final device = DeviceInfo.fromJson(data);
      final devices = List<DeviceInfo>.from(state.connectedDevices);
      devices.removeWhere((d) => d.deviceId == device.deviceId);
      devices.add(device);
      state = state.copyWith(connectedDevices: devices);
    }

    if (message['type'] == 'device_disconnected') {
      final data = message['data'] as Map<String, dynamic>? ?? const {};
      final deviceId = data['deviceId'] as String?;
      if (deviceId != null) {
        final devices = List<DeviceInfo>.from(state.connectedDevices);
        devices.removeWhere((d) => d.deviceId == deviceId);
        state = state.copyWith(connectedDevices: devices);
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
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.inactive:
        // App is going to background or becoming inactive
        _handleAppBackgrounded();

      case AppLifecycleState.resumed:
        // App is coming back to foreground
        _handleAppResumed();

      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        // App is being terminated or hidden - just mark as backgrounded
        _wasBackgrounded = true;
        _backgroundedAt = DateTime.now();
    }
  }

  void _handleAppBackgrounded() {
    _wasBackgrounded = true;
    _backgroundedAt = DateTime.now();

    // Cancel any pending reconnect timers since we'll handle this on resume
    _reconnectTimer?.cancel();

    // If we have a connection, force close the socket to prevent stale state.
    // iOS will drop the connection anyway when the app is suspended,
    // so it's better to close it cleanly now.
    if (state.connection != null &&
        state.status == ConnectionStatus.connected) {
      _socket.forceClose();
    }
  }

  void _handleAppResumed() {
    if (!_wasBackgrounded) return;
    _wasBackgrounded = false;

    // Calculate how long we were backgrounded
    final backgroundDuration = _backgroundedAt != null
        ? DateTime.now().difference(_backgroundedAt!)
        : Duration.zero;

    // If we have a saved connection and we're not connected, reconnect immediately
    final connection = state.connection;
    if (connection != null && state.status != ConnectionStatus.connected) {
      // Reset failure streak since this is a fresh resume
      _failureStreak = 0;
      _reconnectAttempts = 0;

      // For short background durations (<30s), the server might still have our session
      // For longer durations, we need a full reconnect
      final preferredType = backgroundDuration.inSeconds < 30
          ? _lastSuccessfulType
          : null;

      // Connect immediately (no timer delay)
      connect(connection, preferredType: preferredType);
    } else if (connection != null &&
        state.status == ConnectionStatus.connected) {
      // We think we're connected, but the socket might be stale after backgrounding.
      // Check if the socket is actually healthy
      if (!_socket.isHealthy) {
        _socket.forceClose();
        _failureStreak = 0;
        _reconnectAttempts = 0;
        connect(connection, preferredType: _lastSuccessfulType);
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _statusSub?.cancel();
    _messageSub?.cancel();
    _networkSub?.cancel();
    _reconnectTimer?.cancel();
    _sentMessages.clear();
    super.dispose();
  }
}

final connectionProvider =
    StateNotifierProvider<ConnectionNotifier, BridgeConnectionState>((ref) {
      final storage = ref.watch(storageServiceProvider);
      final socket = ref.watch(webSocketServiceProvider);
      final networkMonitor = ref.watch(networkMonitorServiceProvider);
      final bridge = ref.watch(bridgeServiceProvider);
      return ConnectionNotifier(storage, socket, networkMonitor, bridge);
    });
