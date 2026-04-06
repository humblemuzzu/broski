import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/connection.dart';
import 'package:broski/models/connection_quality.dart';
import 'package:broski/models/device.dart';
import 'package:broski/providers/app_subscription_provider.dart';
import 'package:broski/providers/connection/connection_endpoint_racer.dart';
import 'package:broski/providers/connection/connection_error_policy.dart';
import 'package:broski/providers/onboarding_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/network_monitor_service.dart';
import 'package:broski/services/storage_service.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Event emitted when connection state changes significantly.
/// Providers can listen to this to invalidate/refresh their data.
enum ConnectionEvent {
  /// Successfully connected (initial or after reconnect)
  connected,

  /// Disconnected (may trigger reconnection)
  disconnected,

  /// Reconnected after being disconnected - providers should refresh data
  reconnected,

  /// Connection failed - might switch to offline mode
  failed,
}

class BridgeConnectionState {
  const BridgeConnectionState({
    this.connection,
    this.status = ConnectionStatus.disconnected,
    this.error,
    this.opencodeRunning = true,
    this.backends,
    this.isReconnecting = false,
    this.rttMs,
    this.isOfflineMode = false,
    this.devBypassAutoOfflineEnabled = true,
    this.connectionType = ConnectionType.unknown,
    this.connectedHost,
    this.thisDevice,
    this.connectedDevices = const [],
    this.lastEvent,

    this.appProtocolVersion = BridgeService.protocolVersion,
    this.bridgeProtocolVersion,
    this.protocolBannerDismissed = false,
  });

  final ConnectionInfo? connection;
  final ConnectionStatus status;
  final String? error;
  final bool opencodeRunning;
  final AgentsStatus? backends;
  final bool isReconnecting;
  final int? rttMs;
  final ConnectionType connectionType;
  final String? connectedHost;

  final DeviceInfo? thisDevice;
  final List<DeviceInfo> connectedDevices;

  final String appProtocolVersion;
  final String? bridgeProtocolVersion;
  final bool protocolBannerDismissed;

  bool get hasProtocolMismatch =>
      bridgeProtocolVersion != null &&
      bridgeProtocolVersion != appProtocolVersion;

  /// When true, the app operates in read-only mode using cached data.
  /// User can browse projects, sessions, and messages but cannot send new messages.
  final bool isOfflineMode;

  /// DEV BYPASS ONLY: when enabled, RootScreen auto-enters offline mode to allow UI preview.
  /// This must be disabled once the user explicitly tries to reconnect/scan,
  /// otherwise RootScreen will immediately force the user back into offline mode.
  final bool devBypassAutoOfflineEnabled;

  /// Last connection event (for providers to react to reconnection)
  final ConnectionEvent? lastEvent;

  bool get isConnected => status == ConnectionStatus.connected;
  bool get isConnecting => status == ConnectionStatus.connecting;

  String get connectionDescription {
    if (!isConnected) return 'Disconnected';

    final tlsTag = connection?.tlsEnabled == true ? ' • TLS' : '';
    switch (connectionType) {
      case ConnectionType.local:
        return 'Local • ${rttMs ?? 0}ms$tlsTag';
      case ConnectionType.hotspot:
        return 'Hotspot • ${rttMs ?? 0}ms$tlsTag';
      case ConnectionType.tailscale:
        return 'Tailscale • ${rttMs ?? 0}ms$tlsTag';
      case ConnectionType.magicDNS:
        return 'MagicDNS • ${rttMs ?? 0}ms$tlsTag';
      case ConnectionType.unknown:
        return 'Connected • ${rttMs ?? 0}ms$tlsTag';
    }
  }

  BridgeConnectionState copyWith({
    ConnectionInfo? connection,
    bool clearConnection = false,
    ConnectionStatus? status,
    String? error,
    bool? opencodeRunning,
    AgentsStatus? backends,
    bool? isReconnecting,
    int? rttMs,
    bool? isOfflineMode,
    bool? devBypassAutoOfflineEnabled,
    ConnectionType? connectionType,
    String? connectedHost,
    DeviceInfo? thisDevice,
    List<DeviceInfo>? connectedDevices,
    ConnectionEvent? lastEvent,

    String? bridgeProtocolVersion,
    bool? protocolBannerDismissed,
  }) {
    return BridgeConnectionState(
      connection: clearConnection ? null : (connection ?? this.connection),
      status: status ?? this.status,
      error: error,
      opencodeRunning: opencodeRunning ?? this.opencodeRunning,
      backends: backends ?? this.backends,
      isReconnecting: isReconnecting ?? this.isReconnecting,
      rttMs: rttMs ?? this.rttMs,
      isOfflineMode: isOfflineMode ?? this.isOfflineMode,
      devBypassAutoOfflineEnabled:
          devBypassAutoOfflineEnabled ?? this.devBypassAutoOfflineEnabled,
      connectionType: connectionType ?? this.connectionType,
      connectedHost: connectedHost ?? this.connectedHost,
      thisDevice: thisDevice ?? this.thisDevice,
      connectedDevices: connectedDevices ?? this.connectedDevices,
      lastEvent: lastEvent ?? this.lastEvent,

      appProtocolVersion: appProtocolVersion,
      bridgeProtocolVersion:
          bridgeProtocolVersion ?? this.bridgeProtocolVersion,
      protocolBannerDismissed:
          protocolBannerDismissed ?? this.protocolBannerDismissed,
    );
  }

  int get otherDevicesCount {
    if (thisDevice == null) return connectedDevices.length;
    return connectedDevices
        .where((d) => d.deviceId != thisDevice!.deviceId)
        .length;
  }
}

/// Claudis-style exponential backoff policy for robust reconnection.
/// Based on production-proven patterns from Claudis and Happy projects.
class ReconnectPolicy {
  const ReconnectPolicy({
    required this.initialMs,
    required this.maxMs,
    required this.factor,
    required this.jitter,
    required this.maxAttempts,
  });

  /// Starting delay in milliseconds
  final int initialMs;

  /// Maximum delay cap in milliseconds
  final int maxMs;

  /// Exponential backoff multiplier (e.g., 1.8 means 80% increase each attempt)
  final double factor;

  /// Jitter factor (0.25 = +/- 25% randomization to prevent thundering herd)
  final double jitter;

  /// Maximum number of reconnection attempts (0 = infinite)
  final int maxAttempts;

  /// Default policy: matches Claudis (2s initial, 30s max, 1.8 factor, 25% jitter, 12 attempts)
  static const defaultPolicy = ReconnectPolicy(
    initialMs: 2000,
    maxMs: 30000,
    factor: 1.8,
    jitter: 0.25,
    maxAttempts: 12,
  );

  /// Aggressive policy for quick recovery after short disconnects
  static const aggressive = ReconnectPolicy(
    initialMs: 500,
    maxMs: 5000,
    factor: 1.5,
    jitter: 0.2,
    maxAttempts: 20,
  );

  /// Conservative policy for unreliable networks
  static const conservative = ReconnectPolicy(
    initialMs: 3000,
    maxMs: 60000,
    factor: 2.0,
    jitter: 0.3,
    maxAttempts: 10,
  );
}

/// Compute backoff delay using exponential backoff with jitter.
/// This is the Claudis algorithm for robust reconnection.
int computeBackoff(ReconnectPolicy policy, int attempt, Random random) {
  // Calculate base delay with exponential growth
  final base = policy.initialMs * pow(policy.factor, max(attempt - 1, 0));

  // Add jitter (randomization) to prevent thundering herd
  final jitterAmount = base * policy.jitter * random.nextDouble();

  // Return clamped value
  return min(policy.maxMs, (base + jitterAmount).round());
}

class ConnectionNotifier extends StateNotifier<BridgeConnectionState>
    with WidgetsBindingObserver {
  ConnectionNotifier(
    this._ref,
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

  final Ref _ref;
  final StorageService _storage;
  final WebSocketService _socket;
  final NetworkMonitorService _networkMonitor;
  final BridgeService _bridge;

  StreamSubscription<ConnectionStatus>? _statusSub;
  StreamSubscription<Map<String, dynamic>>? _messageSub;
  StreamSubscription<NetworkState>? _networkSub;
  Timer? _reconnectTimer;
  Timer? _networkDebounceTimer;
  int _reconnectAttempts = 0;
  int _failureStreak = 0;
  bool _isConnecting = false;
  bool _licenseRetryAttempted = false; // Prevents infinite license sync loop
  bool _onboardingRetryAttempted =
      false; // One retry for Local Network permission timeout
  final _random = Random();

  // Current reconnection policy (can be adjusted based on conditions)
  ReconnectPolicy _currentPolicy = ReconnectPolicy.defaultPolicy;

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
  bool _isBackgrounding =
      false; // Prevents reconnect scheduling during intentional background

  Future<void> _loadSavedConnection() async {
    final saved = await _storage.loadConnection();
    if (saved != null) {
      debugPrint('[Connection] Loading saved connection:');
      debugPrint('  - localIP: ${saved.localIP}');
      debugPrint('  - tailscaleIP: ${saved.tailscaleIP}');
      debugPrint('  - port: ${saved.port}');
      debugPrint('  - hasAuthToken: ${saved.authToken != null}');
      // Only hydrate state here. RootScreen decides when/if to auto-connect.
      // This prevents unpaid users from entering reconnect loops before the
      // subscription state is fully known.
      state = state.copyWith(connection: saved);
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
    debugPrint(
      '[Connection] connect() called - _isConnecting: $_isConnecting, attempts: $_reconnectAttempts',
    );
    if (_isConnecting) {
      debugPrint('[Connection] connect() SKIPPED - already connecting');
      return;
    }
    _isConnecting = true;
    _isBackgrounding =
        false; // Clear backgrounding flag when starting new connection
    _reconnectTimer?.cancel();
    if (state.connection != null && !state.connection!.sameIdentity(info)) {
      _socket.clearQueuedMessages();
    }
    _socket.beginHandshake();

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

      // Try endpoints (first success wins)
      final result = await _tryConnectConcurrent(endpoints, info);

      // App went to background while we were awaiting — abort cleanly.
      // forceClose() already killed the socket; continuing would just
      // produce confusing errors.
      if (_isBackgrounding) {
        debugPrint('[Connection] Aborting connect — app went to background');
        return;
      }

      if (result == null || !result.success) {
        throw StateError(
          result?.error?.toString() ?? 'All connection attempts failed',
        );
      }

      await _storage.saveConnection(info);

      // Determine if this is a reconnection (we had previous attempts)
      final wasReconnecting = _reconnectAttempts > 0;

      _reconnectAttempts = 0;
      _failureStreak = 0;

      _lastSuccessfulConnection = DateTime.now();
      _lastSuccessfulType = result.type;

      // Update WebSocket service with connection info for batching
      _socket.updateConnectionType(_connectionTypeToString(result.type));

      // Emit appropriate connection event for providers to react
      final connectionEvent = wasReconnecting
          ? ConnectionEvent.reconnected
          : ConnectionEvent.connected;

      debugPrint(
        '[Connection] Socket ready via ${result.type.name}, completing auth handshake',
      );

      final subState = _ref.read(appSubscriptionProvider);
      final sessionToken = await _storage.getAppSessionToken();
      debugPrint(
        '[Connection] Auth check - entitled: ${subState.entitled}, hasSessionToken: ${sessionToken != null}',
      );

      // If the user is locally entitled, cloud auth must be present.
      // Without it, the bridge will (correctly) reject us, which otherwise
      // looks like an infinite reconnect loop. Fail fast with a clear error.
      if (subState.entitled && sessionToken == null) {
        throw StateError(
          'Invalid session (missing sign-in token). Please sign out and sign in again.',
        );
      }

      if (sessionToken != null) {
        debugPrint('[Connection] Sending auth_session...');
        await _bridge.authSession(sessionToken: sessionToken);
        debugPrint('[Connection] auth_session SUCCESS');
        _licenseRetryAttempted = false; // Reset on successful auth
        _onboardingRetryAttempted = false; // Reset on successful auth
      }
      _socket.endHandshake();
      debugPrint('[Connection] Handshake ended, queue flushed');

      state = state.copyWith(
        status: ConnectionStatus.connected,
        isReconnecting: false,
        error: null,
        connectionType: result.type,
        connectedHost: result.host,
        lastEvent: connectionEvent,
      );

      await _registerThisDevice();
    } catch (error) {
      debugPrint('[Connection] connect() FAILED: $error');
      // If we failed before completing auth, drop handshake gating to avoid
      // permanently queuing messages.
      _socket.cancelHandshake();
      _failureStreak++;
      final errString = '$error';
      final lower = errString.toLowerCase();
      debugPrint(
        '[Connection] Error analysis - isLicense: ${lower.contains('license')}, isAuth: ${lower.contains('401') || lower.contains('unauthorized')}',
      );
      final isMissingSessionToken =
          lower.contains('missing sign-in token') ||
          lower.contains('missing session token');
      final isLicenseError =
          lower.contains('license_required') ||
          lower.contains('license required') ||
          lower.contains('license_expired') ||
          lower.contains('license signing') ||
          lower.contains('cloud auth failed') ||
          lower.contains('cloud_auth_failed');
      final isTooManyMachines = lower.contains('too many machines');
      final isAuthError =
          errString.contains('401') ||
          lower.contains('unauthorized') ||
          lower.contains('forbidden') ||
          lower.contains('invalid session') ||
          isLicenseError;
      final isPinError =
          lower.contains('handshake') && lower.contains('certificate');

      // For license errors: server is authoritative.
      // If server says LICENSE_REQUIRED, that's final - don't retry endlessly.
      // Only try ONE sync refresh if locally entitled, then STOP.
      if (isLicenseError && !isTooManyMachines) {
        final subState = _ref.read(appSubscriptionProvider);

        if (_licenseRetryAttempted) {
          // Already tried sync once - server still says no. STOP.
          debugPrint(
            '[Connection] License retry already attempted - STOPPING (server is authoritative)',
          );
          // Server is authoritative — sync entitlement state so UI shows paywall
          _ref.read(appSubscriptionProvider.notifier).seedEntitlement(false);
          state = state.copyWith(
            status: ConnectionStatus.disconnected,
            error:
                'Subscription not active on server. Please check your subscription status.',
            lastEvent: ConnectionEvent.failed,
            isReconnecting: false,
          );
          return;
        }

        if (subState.entitled) {
          // Local says entitled, server says no - try ONE sync
          _licenseRetryAttempted = true;
          debugPrint(
            '[Connection] License error but locally entitled - trying ONE sync (then stop)',
          );
          state = state.copyWith(
            status: ConnectionStatus.disconnected,
            error: 'Verifying subscription...',
            lastEvent: ConnectionEvent.failed,
            isReconnecting: true,
          );

          Future.microtask(() async {
            try {
              await _ref
                  .read(appSubscriptionProvider.notifier)
                  .configureAndRefresh();
              await Future.delayed(const Duration(seconds: 2));

              // After sync, try ONE more time - but flag is set so if it fails again we stop
              debugPrint('[Connection] Sync done - trying ONE more connection');
              if (state.connection != null) {
                connect(state.connection!);
              }
            } catch (e) {
              debugPrint('[Connection] Subscription sync failed: $e');
              state = state.copyWith(
                status: ConnectionStatus.disconnected,
                error: 'Subscription sync failed. Please try again.',
                isReconnecting: false,
              );
            }
          });
          return;
        }
      }

      // Determine error message
      String errorMessage;
      if (isTooManyMachines) {
        errorMessage =
            'Machine limit reached (3 max). Remove a device in Account settings.';
      } else if (isMissingSessionToken) {
        errorMessage = 'Sign-in expired. Please sign out and sign in again.';
      } else if (lower.contains('license signing') ||
          lower.contains('cloud auth failed')) {
        // Server-side configuration issue - not a user problem
        errorMessage =
            'Server configuration error. Please contact support or try again later.';
      } else if (isLicenseError) {
        errorMessage = 'Subscription required. Subscribe to Pro in Settings.';
      } else if (isAuthError) {
        errorMessage = 'Authentication failed. Scan a new QR code.';
      } else if (isPinError) {
        errorMessage =
            'Secure connection failed (certificate mismatch). Scan a new QR code.';
      } else {
        errorMessage = errString;
      }

      // During onboarding, if the first connection attempt timed out (likely
      // because iOS showed the Local Network permission dialog), do ONE
      // automatic retry after a short delay. The user probably tapped "Allow"
      // while the timeout was firing. After this single retry, we stop — the
      // onboarding guard in _scheduleSmartReconnect prevents further loops.
      final isTimeout = lower.contains('timeout');
      final onboarding = _ref.read(onboardingProvider);
      if (isTimeout &&
          !onboarding.hasCompletedOnboarding &&
          _failureStreak == 1 &&
          !_onboardingRetryAttempted) {
        _onboardingRetryAttempted = true;
        debugPrint(
          '[Connection] Timeout during onboarding (first attempt) — '
          'retrying once in 2s for Local Network permission',
        );
        state = state.copyWith(
          status: ConnectionStatus.disconnected,
          error: null,
          lastEvent: ConnectionEvent.failed,
          isReconnecting: true,
        );
        Future.delayed(const Duration(seconds: 2), () {
          final conn = state.connection;
          if (conn != null) {
            connect(conn);
          }
        });
        return;
      }

      final blocksRetry =
          isAuthError || isLicenseError || isTooManyMachines || isPinError;
      state = state.copyWith(
        status: ConnectionStatus.disconnected,
        error: errorMessage,
        lastEvent: ConnectionEvent.failed,
        isReconnecting: !blocksRetry,
      );
      // Don't auto-reconnect for auth/license/cert errors - user needs to take action
      if (!blocksRetry) {
        _scheduleSmartReconnect();
      }
    } finally {
      _isConnecting = false;
    }
  }

  /// Build list of endpoints to try, ordered by preference.
  List<ConnectionEndpoint> _buildEndpointsToTry(
    ConnectionInfo info,
    ConnectionType? preferredType,
  ) {
    final endpoints = <ConnectionEndpoint>[];

    bool isValidHostname(String host) {
      if (host.isEmpty || host.length > 253) return false;
      // Basic sanity: hostname chars only.
      return RegExp(r'^[a-zA-Z0-9.-]+$').hasMatch(host);
    }

    bool isLoopbackHost(String host) {
      return host == 'localhost' || host == '127.0.0.1' || host == '::1';
    }

    ({int a, int b, int c, int d})? parseIpv4(String host) {
      final parts = host.split('.');
      if (parts.length != 4) return null;
      final nums = <int>[];
      for (final part in parts) {
        final n = int.tryParse(part);
        if (n == null || n < 0 || n > 255) return null;
        nums.add(n);
      }
      return (a: nums[0], b: nums[1], c: nums[2], d: nums[3]);
    }

    bool isPrivateIpv4(String host) {
      final ip = parseIpv4(host);
      if (ip == null) return false;
      // RFC1918 private ranges
      if (ip.a == 10) return true;
      if (ip.a == 172 && ip.b >= 16 && ip.b <= 31) return true;
      if (ip.a == 192 && ip.b == 168) return true;
      // Common hotspot ranges (still private, but be explicit)
      if (ip.a == 172 && ip.b == 20 && ip.c == 10) {
        return true; // iPhone hotspot
      }
      return false;
    }

    bool isTailscaleIpv4(String host) {
      final ip = parseIpv4(host);
      if (ip == null) return false;
      // Tailscale IPv4s are typically in 100.64.0.0/10; allow any 100.* for simplicity.
      return ip.a == 100;
    }

    bool isAllowedTarget(
      ConnectionType type,
      String host, {
      required bool isFunnel,
    }) {
      if (isFunnel) {
        // Funnel URL is HTTPS/WSS. Restrict to tailscale domains.
        if (!isValidHostname(host)) return false;
        return host.endsWith('.ts.net') || host.endsWith('.tailscale.net');
      }
      switch (type) {
        case ConnectionType.local:
        case ConnectionType.hotspot:
          return isPrivateIpv4(host);
        case ConnectionType.tailscale:
          return isTailscaleIpv4(host);
        case ConnectionType.magicDNS:
          return isValidHostname(host) &&
              (host.endsWith('.ts.net') || host.endsWith('.tailscale.net'));
        case ConnectionType.unknown:
          return isValidHostname(host);
      }
    }

    void addEndpoint(
      ConnectionType type,
      String? host, {
      bool isSecure = false,
      bool isFunnel = false,
    }) {
      if (host == null || host.isEmpty) return;
      if (!isAllowedTarget(type, host, isFunnel: isFunnel)) {
        debugPrint(
          '[Connection] Skipping disallowed host for ${type.name}: $host',
        );
        return;
      }

      // Security: do not allow plaintext ws:// for non-loopback connections.
      // The bridge enforces TLS for LAN/hotspot by default; allowing ws:// would
      // enable sniffing/MITM on shared networks.
      if (!isSecure && !isFunnel && !isLoopbackHost(host)) {
        debugPrint(
          '[Connection] Skipping insecure ws:// endpoint for ${type.name}: $host',
        );
        return;
      }

      final scheme = isSecure ? 'wss' : 'ws';
      final baseUri = Uri.parse('$scheme://$host:${info.port}');
      endpoints.add(
        ConnectionEndpoint(
          type: type,
          uri: baseUri,
          host: host,
          isFunnel: isFunnel,
        ),
      );
    }

    // If preferred type specified, add it first
    if (preferredType != null) {
      switch (preferredType) {
        case ConnectionType.local:
          addEndpoint(
            ConnectionType.local,
            info.localIP,
            isSecure: info.tlsEnabled,
          );
        case ConnectionType.hotspot:
          addEndpoint(
            ConnectionType.hotspot,
            info.hotspotIP,
            isSecure: info.tlsEnabled,
          );
        case ConnectionType.tailscale:
          addEndpoint(
            ConnectionType.tailscale,
            info.tailscaleIP,
            isSecure: info.tlsEnabled,
          );
        case ConnectionType.magicDNS:
          addEndpoint(
            ConnectionType.magicDNS,
            info.magicDNSHostname,
            isSecure: info.tlsEnabled,
          );
        case ConnectionType.unknown:
          break;
      }
    }

    // Add all endpoints (if not already added as preferred)
    if (preferredType != ConnectionType.local && info.localIP != null) {
      addEndpoint(
        ConnectionType.local,
        info.localIP,
        isSecure: info.tlsEnabled,
      );
    }
    if (preferredType != ConnectionType.hotspot && info.hotspotIP != null) {
      addEndpoint(
        ConnectionType.hotspot,
        info.hotspotIP,
        isSecure: info.tlsEnabled,
      );
    }
    if (preferredType != ConnectionType.tailscale && info.tailscaleIP != null) {
      addEndpoint(
        ConnectionType.tailscale,
        info.tailscaleIP,
        isSecure: info.tlsEnabled,
      );
    }
    if (preferredType != ConnectionType.magicDNS &&
        info.magicDNSHostname != null) {
      addEndpoint(
        ConnectionType.magicDNS,
        info.magicDNSHostname,
        isSecure: info.tlsEnabled,
      );
    }

    if (info.funnelURL != null && info.funnelURL!.isNotEmpty) {
      final funnelWss = info.funnelURL!.replaceFirst('https://', 'wss://');
      final baseFunnelUri = Uri.parse(funnelWss);
      endpoints.add(
        ConnectionEndpoint(
          type: ConnectionType.unknown,
          uri: baseFunnelUri,
          host: baseFunnelUri.host,
          isFunnel: true,
        ),
      );
    }

    return endpoints;
  }

  Future<ConnectionAttemptResult?> _tryConnectConcurrent(
    List<ConnectionEndpoint> endpoints,
    ConnectionInfo info,
  ) async {
    if (endpoints.isEmpty) return null;

    final connectTimeout = _reconnectAttempts == 0
        ? const Duration(seconds: 10)
        : const Duration(seconds: 3);
    final remaining = List<ConnectionEndpoint>.from(endpoints);
    Object? lastError;

    while (remaining.isNotEmpty) {
      final candidate = await raceConnectionEndpoints(
        remaining,
        info,
        connectTimeout: connectTimeout,
      );
      if (candidate == null) return null;
      if (!candidate.success) {
        return candidate;
      }

      debugPrint(
        '[Connection] Trying ${candidate.type.name}: ${candidate.uri}',
      );

      try {
        final shouldPin =
            info.tlsEnabled &&
            info.certSha256 != null &&
            info.certSha256!.isNotEmpty &&
            !remaining
                .firstWhere((endpoint) => endpoint.uri == candidate.uri)
                .isFunnel;
        await _socket
            .connect(
              candidate.uri,
              authToken: info.authToken,
              pinnedCertSha256: shouldPin ? info.certSha256 : null,
            )
            .timeout(
              connectTimeout,
              onTimeout: () => throw TimeoutException('Connection timeout'),
            );
        debugPrint(
          '[Connection] SUCCESS: Connected via ${candidate.type.name}',
        );
        return candidate;
      } catch (error) {
        debugPrint('[Connection] FAILED ${candidate.type.name}: $error');
        lastError = error;
        remaining.removeWhere((endpoint) => endpoint.uri == candidate.uri);
      }
    }

    final lastCandidate = endpoints.last;
    return ConnectionAttemptResult(
      type: lastCandidate.type,
      uri: lastCandidate.uri,
      host: lastCandidate.host,
      success: false,
      error: lastError,
    );
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
    // Set _isBackgrounding to suppress _handleStatus from scheduling
    // auto-reconnect during the synchronous status callback inside
    // _socket.disconnect(). Without this, the broadcast StreamController
    // fires _handleStatus(disconnected) synchronously, which sees
    // connection != null && !_isConnecting && !_isBackgrounding and
    // schedules a reconnect — defeating the intentional disconnect.
    _isBackgrounding = true;
    await _socket.disconnect();
    _isBackgrounding = false;
    _isConnecting = false;
    _failureStreak = 0;
    _reconnectAttempts = 0;
    state = state.copyWith(
      status: ConnectionStatus.disconnected,
      isReconnecting: false,
    );
  }

  /// Cancel any pending reconnect timer and reset connecting state.
  /// Used by the scan screen to ensure a fresh QR scan is not blocked
  /// by an in-flight auto-reconnect cycle.
  void cancelPendingReconnect() {
    _reconnectTimer?.cancel();
    _isConnecting = false;
    _failureStreak = 0;
    _reconnectAttempts = 0;
    _socket.clearQueuedMessages();
  }

  Future<void> clearConnection() async {
    // Cancel any pending reconnect first
    _reconnectTimer?.cancel();
    _reconnectAttempts = 0;
    _failureStreak = 0;
    _sentMessages.clear();
    _licenseRetryAttempted = false; // Reset for fresh start
    _onboardingRetryAttempted = false; // Reset for fresh start

    // Clear connection state BEFORE disconnecting to prevent
    // _handleStatus from scheduling a reconnect
    await _storage.clearConnection();
    state = state.copyWith(
      clearConnection: true,
      status: ConnectionStatus.disconnected,
      isOfflineMode: false,
      devBypassAutoOfflineEnabled: false,
      isReconnecting: false,
    );

    // Now disconnect the socket
    await _socket.disconnect();
  }

  /// Unpaid preview mode: allow browsing UI but prevent all connect/reconnect
  /// flows. Preserves saved bridge connection so we can auto-reconnect when
  /// the user regains entitlement (e.g. repurchase after expiry).
  ///
  /// This is intentionally idempotent and safe to call multiple times.
  Future<void> enterUnpaidPreviewMode() async {
    // Stop any reconnection activity immediately.
    _reconnectTimer?.cancel();
    _reconnectAttempts = 0;
    _failureStreak = 0;
    _sentMessages.clear();

    // Disconnect socket and enter offline mode, but KEEP saved connection
    // data in storage so auto-reconnect works after subscription renewal.
    state = state.copyWith(
      status: ConnectionStatus.disconnected,
      isOfflineMode: true,
      devBypassAutoOfflineEnabled: false,
      isReconnecting: false,
      error: null,
    );

    await _socket.disconnect();
  }

  /// Enter offline/preview mode - allows browsing cached data without connection
  void enterOfflineMode() {
    _reconnectTimer?.cancel();
    state = state.copyWith(isOfflineMode: true, isReconnecting: false);
  }

  /// Exit offline mode
  void exitOfflineMode() {
    state = state.copyWith(
      isOfflineMode: false,
      devBypassAutoOfflineEnabled: false,
    );
    // Try to reconnect if we have a saved connection
    final connection = state.connection;
    if (connection != null) {
      connect(connection);
    }
  }

  void dismissProtocolBanner() {
    state = state.copyWith(protocolBannerDismissed: true);
  }

  /// Ensure we attempt to reconnect automatically when we have a saved
  /// connection and the user is entitled.
  ///
  /// RootScreen can call this when rendering the "connected app" surfaces,
  /// to avoid a one-frame jump to ConnectionLostScreen on cold start.
  void kickOffAutoReconnectIfNeeded() {
    if (state.connection == null) return;
    if (state.isOfflineMode) return;
    if (_isConnecting) return;
    if (state.isReconnecting) return;
    if (_isBackgrounding) return;

    final sub = _ref.read(appSubscriptionProvider);
    if (!sub.entitled) return;

    _reconnectTimer?.cancel();
    _reconnectAttempts = max(_reconnectAttempts, 1);
    state = state.copyWith(isReconnecting: true, error: null);
    Future.microtask(
      () => connect(state.connection!, preferredType: _lastSuccessfulType),
    );
  }

  void _handleStatus(ConnectionStatus status) {
    debugPrint(
      '[Connection] _handleStatus: $status (current: ${state.status}, isConnecting: $_isConnecting, isBackgrounding: $_isBackgrounding, isReconnecting: ${state.isReconnecting})',
    );
    if (status == ConnectionStatus.connected && _isConnecting) {
      return;
    }
    // Only schedule reconnect if we unexpectedly disconnected (not during intentional reconnect)
    // Skip if we're intentionally backgrounding - we'll handle reconnect in _handleAppResumed
    if (status == ConnectionStatus.disconnected &&
        state.connection != null &&
        !_isConnecting &&
        !_isBackgrounding &&
        !state.isOfflineMode) {
      final sub = _ref.read(appSubscriptionProvider);
      debugPrint('[Connection] Disconnected - entitled: ${sub.entitled}');
      if (blocksAutoReconnect(
        entitled: sub.entitled,
        error: state.error,
        licenseRetryAttempted: _licenseRetryAttempted,
      )) {
        state = state.copyWith(isReconnecting: false);
        return;
      }
      debugPrint(
        '[Connection] Disconnected unexpectedly, scheduling reconnect',
      );
      _scheduleSmartReconnect();
    }

    // Emit appropriate event
    ConnectionEvent? event;
    if (status == ConnectionStatus.disconnected &&
        state.status != ConnectionStatus.disconnected) {
      event = ConnectionEvent.disconnected;
    } else if (status == ConnectionStatus.connected &&
        state.status != ConnectionStatus.connected) {
      event = ConnectionEvent.connected;
    }

    state = state.copyWith(status: status, lastEvent: event);
  }

  void _handleMessage(Map<String, dynamic> message) {
    if (message['type'] == 'status') {
      final data = message['data'] as Map<String, dynamic>? ?? const {};
      final running = data['opencodeRunning'] == true;
      final backendsJson = data['backends'] as Map<String, dynamic>?;
      final backends = backendsJson != null
          ? AgentsStatus.fromJson(backendsJson)
          : state.backends;
      state = state.copyWith(opencodeRunning: running, backends: backends);
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
      final proto = message['protocolVersion'] as String?;
      final resetDismiss =
          proto != null && proto != state.bridgeProtocolVersion;
      state = state.copyWith(
        thisDevice: device,
        bridgeProtocolVersion: proto,
        protocolBannerDismissed: resetDismiss ? false : null,
      );
    }

    if (message['type'] == 'network_endpoints_updated') {
      final data = message['data'] as Map<String, dynamic>? ?? const {};
      final conn = state.connection;
      if (conn != null) {
        final updated = ConnectionInfo(
          localIP: data['localIP'] as String? ?? conn.localIP,
          tailscaleIP: data['tailscaleIP'] as String? ?? conn.tailscaleIP,
          hotspotIP: data['hotspotIP'] as String? ?? conn.hotspotIP,
          magicDNSHostname: conn.magicDNSHostname,
          funnelURL: conn.funnelURL,
          port: conn.port,
          version: conn.version,
          authToken: conn.authToken,
          tlsEnabled: conn.tlsEnabled,
          certSha256: conn.certSha256,
        );
        if (!conn.sameIdentity(updated)) {
          state = state.copyWith(connection: updated);
          _storage.saveConnection(updated);
          debugPrint(
            '[Connection] Endpoints updated — '
            'local=${updated.localIP}, ts=${updated.tailscaleIP}, '
            'hotspot=${updated.hotspotIP}',
          );
        }
      }
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
  /// Debounced (1s) to prevent reconnect storms when the network bounces
  /// rapidly (e.g. WiFi→cell→WiFi on elevator/subway transitions).
  void _handleNetworkChange(NetworkState networkState) {
    final hasNetwork =
        networkState != NetworkState.none &&
        networkState != NetworkState.unknown;

    if (!hasNetwork) return;
    if (state.connection == null) return;
    if (state.status != ConnectionStatus.disconnected) return;
    if (_isConnecting) return;
    if (state.isOfflineMode) return;

    final sub = _ref.read(appSubscriptionProvider);
    if (!sub.entitled) return;

    // Debounce: wait 1s for the network to settle before reacting.
    // Each new event restarts the timer, so rapid WiFi→cell→WiFi
    // only fires one reconnect attempt after the storm passes.
    _networkDebounceTimer?.cancel();
    _networkDebounceTimer = Timer(const Duration(seconds: 1), () {
      // Re-check guards — state may have changed during the debounce window
      if (state.connection == null) return;
      if (state.status != ConnectionStatus.disconnected) return;
      if (_isConnecting) return;

      _failureStreak = 0;
      _reconnectAttempts = max(_reconnectAttempts, 1);
      _reconnectTimer?.cancel();

      ConnectionType? preferredType;
      if (networkState == NetworkState.vpn) {
        preferredType = _lastSuccessfulType ?? ConnectionType.tailscale;
      } else if (networkState == NetworkState.wifi ||
          networkState == NetworkState.ethernet) {
        preferredType = ConnectionType.local;
      }

      final connection = state.connection;
      if (connection != null) {
        connect(connection, preferredType: preferredType);
      }
    });
  }

  /// Smart reconnection that adapts strategy based on failure patterns.
  /// Uses Claudis-style exponential backoff with jitter for robust reconnection.
  void _scheduleSmartReconnect() {
    if (state.connection == null) return;
    if (_reconnectTimer?.isActive ?? false) return;
    if (state.isOfflineMode) return;
    final sub = _ref.read(appSubscriptionProvider);
    if (!sub.entitled) return;

    // During onboarding, don't auto-reconnect. The user should just re-scan.
    // The reconnect machinery is designed for post-onboarding scenarios where
    // an established connection drops (WiFi loss, Mac sleep, app background).
    // During onboarding, a failed connection is usually caused by iOS Local
    // Network permission dialog, wrong network, or bridge not running yet.
    final onboarding = _ref.read(onboardingProvider);
    if (!onboarding.hasCompletedOnboarding) {
      debugPrint(
        '[Connection] Skipping auto-reconnect — onboarding not complete',
      );
      state = state.copyWith(isReconnecting: false);
      return;
    }

    // Select reconnection policy based on conditions
    _currentPolicy = _selectReconnectPolicy();
    _reconnectAttempts += 1;

    // After max attempts, switch to a slow 60s retry instead of giving up.
    // This keeps the connection recoverable (e.g. Mac wakes from long sleep)
    // without burning battery on rapid retries.
    if (_currentPolicy.maxAttempts > 0 &&
        _reconnectAttempts >= _currentPolicy.maxAttempts) {
      debugPrint(
        '[Connection] Max rapid attempts reached (${_currentPolicy.maxAttempts}), '
        'switching to slow 60s retry',
      );
      state = state.copyWith(
        isReconnecting: true,
        error:
            'Unable to reconnect after ${_currentPolicy.maxAttempts} attempts. Still trying…',
      );
      _reconnectTimer = Timer(const Duration(seconds: 60), () {
        final connection = state.connection;
        if (connection != null) {
          connect(connection, preferredType: _lastSuccessfulType);
        }
      });
      return;
    }

    state = state.copyWith(isReconnecting: true);

    // Compute backoff delay with jitter (Claudis algorithm)
    final delayMs = computeBackoff(_currentPolicy, _reconnectAttempts, _random);

    debugPrint(
      '[Connection] Scheduling reconnect attempt $_reconnectAttempts in ${delayMs}ms',
    );

    _reconnectTimer = Timer(Duration(milliseconds: delayMs), () {
      final connection = state.connection;
      if (connection != null) {
        // Try last successful connection type first if available
        connect(connection, preferredType: _lastSuccessfulType);
      }
    });
  }

  /// Select the appropriate reconnection policy based on current conditions.
  ReconnectPolicy _selectReconnectPolicy() {
    // If we had a recent success (within 30s), use aggressive recovery
    if (_lastSuccessfulConnection != null) {
      final timeSinceSuccess = DateTime.now().difference(
        _lastSuccessfulConnection!,
      );
      if (timeSinceSuccess.inSeconds < 30 && _failureStreak < 3) {
        return ReconnectPolicy.aggressive;
      }
    }

    // Based on failure streak
    if (_failureStreak < 3) {
      return ReconnectPolicy.aggressive;
    } else if (_failureStreak < 6) {
      return ReconnectPolicy.defaultPolicy;
    } else {
      return ReconnectPolicy.conservative;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
        // App is going to background or becoming inactive
        _handleAppBackgrounded();

      case AppLifecycleState.resumed:
        // App is coming back to foreground
        _handleAppResumed();

      case AppLifecycleState.inactive:
        // iOS: Pulling notification shade / Control Center triggers `inactive`
        // briefly while the app is still foreground-visible. We should not
        // force-close the socket here; doing so causes reconnect loops.
        break;

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
    _isBackgrounding =
        true; // Set BEFORE forceClose - _handleStatus checks this

    // Cancel any existing reconnect timer
    _reconnectTimer?.cancel();

    // If we have a connection, force close the socket to prevent stale state.
    // iOS will drop the connection anyway when the app is suspended,
    // so it's better to close it cleanly now.
    if (state.connection != null &&
        state.status == ConnectionStatus.connected) {
      _socket.forceClose();
    }

    // Clear reconnecting state since we'll handle it on resume
    state = state.copyWith(isReconnecting: false);
    // NOTE: Don't reset _isBackgrounding here - it's reset in _handleAppResumed
  }

  void _handleAppResumed() {
    if (!_wasBackgrounded) return;
    _wasBackgrounded = false;
    _isBackgrounding = false; // Reset flag - safe to schedule reconnects again

    // Calculate how long we were backgrounded
    final backgroundDuration = _backgroundedAt != null
        ? DateTime.now().difference(_backgroundedAt!)
        : Duration.zero;

    // If we have a saved connection and we're not connected, reconnect immediately
    final connection = state.connection;
    if (connection != null && state.status != ConnectionStatus.connected) {
      // Reset failure streak since this is a fresh resume
      _failureStreak = 0;
      _reconnectAttempts = max(_reconnectAttempts, 1);

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
        _reconnectAttempts = max(_reconnectAttempts, 1);
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
    _networkDebounceTimer?.cancel();
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
      return ConnectionNotifier(ref, storage, socket, networkMonitor, bridge);
    });
