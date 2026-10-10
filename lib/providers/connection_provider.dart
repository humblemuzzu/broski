import 'dart:async';
import 'dart:io';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/device.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Event emitted when connection state changes significantly.
/// Providers can listen to this to invalidate/refresh their data.
enum ConnectionEvent { connected, disconnected, reconnected }

class BridgeConnectionState {
  const BridgeConnectionState({
    this.status = ConnectionStatus.disconnected,
    this.opencodeRunning = true,
    this.backends,
    this.isReconnecting = false,
    this.rttMs,
    this.isOfflineMode = false,
    this.devBypassAutoOfflineEnabled = true,
    this.thisDevice,
    this.connectedDevices = const [],
    this.lastEvent,
    this.appProtocolVersion = BridgeService.protocolVersion,
    this.bridgeProtocolVersion,
    this.protocolBannerDismissed = false,
  });

  final ConnectionStatus status;
  final bool opencodeRunning;
  final AgentsStatus? backends;
  final bool isReconnecting;
  final int? rttMs;
  final DeviceInfo? thisDevice;
  final List<DeviceInfo> connectedDevices;
  final String appProtocolVersion;
  final String? bridgeProtocolVersion;
  final bool protocolBannerDismissed;

  /// When true, the app operates in read-only mode using cached data.
  final bool isOfflineMode;

  /// DEV BYPASS ONLY: when enabled, RootScreen auto-enters offline mode to
  /// allow UI preview; cleared once the user explicitly leaves offline mode.
  final bool devBypassAutoOfflineEnabled;

  final ConnectionEvent? lastEvent;

  bool get hasProtocolMismatch =>
      bridgeProtocolVersion != null &&
      bridgeProtocolVersion != appProtocolVersion;

  bool get isConnected => status == ConnectionStatus.connected;
  bool get isConnecting => status == ConnectionStatus.connecting;

  int get otherDevicesCount {
    final self = thisDevice;
    if (self == null) return connectedDevices.length;
    return connectedDevices.where((d) => d.deviceId != self.deviceId).length;
  }

  BridgeConnectionState copyWith({
    ConnectionStatus? status,
    bool? opencodeRunning,
    AgentsStatus? backends,
    bool? isReconnecting,
    int? rttMs,
    bool? isOfflineMode,
    bool? devBypassAutoOfflineEnabled,
    DeviceInfo? thisDevice,
    List<DeviceInfo>? connectedDevices,
    ConnectionEvent? lastEvent,
    String? bridgeProtocolVersion,
    bool? protocolBannerDismissed,
  }) {
    return BridgeConnectionState(
      status: status ?? this.status,
      opencodeRunning: opencodeRunning ?? this.opencodeRunning,
      backends: backends ?? this.backends,
      isReconnecting: isReconnecting ?? this.isReconnecting,
      rttMs: rttMs ?? this.rttMs,
      isOfflineMode: isOfflineMode ?? this.isOfflineMode,
      devBypassAutoOfflineEnabled:
          devBypassAutoOfflineEnabled ?? this.devBypassAutoOfflineEnabled,
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
}

/// The bridge connection as the rest of the app sees it.
///
/// The Broski Link controller owns connecting, routes, resume and backoff and
/// publishes its state through [WebSocketService]; this notifier mirrors that
/// status and the bridge's own status/device messages.
class ConnectionNotifier extends StateNotifier<BridgeConnectionState> {
  ConnectionNotifier(this._ref, this._socket, this._bridge)
    : super(const BridgeConnectionState()) {
    _statusSub = _socket.statusStream.listen(_handleStatus);
    _messageSub = _socket.messages.listen(_handleMessage);
  }

  final Ref _ref;
  final WebSocketService _socket;
  final BridgeService _bridge;

  StreamSubscription<ConnectionStatus>? _statusSub;
  StreamSubscription<Map<String, dynamic>>? _messageSub;
  var _everConnected = false;

  Future<List<DeviceInfo>> listDevices() => _bridge.listDevices();

  void disconnectDevice(String deviceId) => _bridge.disconnectDevice(deviceId);

  /// Leaves the current machine: the link closes and the app returns to the
  /// scanner. The machine stays paired and can be selected again.
  Future<void> clearConnection() async {
    _everConnected = false;
    await _ref.read(machinesProvider.notifier).select(null);
    state = state.copyWith(
      status: ConnectionStatus.disconnected,
      isOfflineMode: false,
      devBypassAutoOfflineEnabled: false,
      isReconnecting: false,
    );
  }

  void enterOfflineMode() {
    state = state.copyWith(isOfflineMode: true, isReconnecting: false);
  }

  void exitOfflineMode() {
    state = state.copyWith(
      isOfflineMode: false,
      devBypassAutoOfflineEnabled: false,
    );
  }

  void dismissProtocolBanner() {
    state = state.copyWith(protocolBannerDismissed: true);
  }

  void _handleStatus(ConnectionStatus status) {
    switch (status) {
      case ConnectionStatus.connected:
        final event = _everConnected
            ? ConnectionEvent.reconnected
            : ConnectionEvent.connected;
        _everConnected = true;
        state = state.copyWith(
          status: status,
          isReconnecting: false,
          lastEvent: event,
        );
        unawaited(_registerThisDevice());
      case ConnectionStatus.connecting:
        state = state.copyWith(status: status, isReconnecting: _everConnected);
      case ConnectionStatus.disconnected:
        final event = state.status == ConnectionStatus.disconnected
            ? null
            : ConnectionEvent.disconnected;
        state = state.copyWith(status: status, lastEvent: event);
    }
  }

  Future<void> _registerThisDevice() async {
    final identity = await _ref.read(deviceIdentityProvider.future);
    _bridge.registerDevice(
      deviceId: identity.id,
      deviceName: _deviceName(),
      platform: Platform.operatingSystem,
    );
  }

  String _deviceName() {
    if (Platform.isIOS) return 'iPhone';
    if (Platform.isAndroid) return 'Android';
    return Platform.operatingSystem;
  }

  void _handleMessage(Map<String, dynamic> message) {
    final raw = message['data'];
    final data = raw is Map<String, dynamic> ? raw : const <String, dynamic>{};
    switch (message['type']) {
      case 'status':
        final backendsJson = data['backends'] as Map<String, dynamic>?;
        state = state.copyWith(
          opencodeRunning: data['opencodeRunning'] == true,
          backends: backendsJson != null
              ? AgentsStatus.fromJson(backendsJson)
              : state.backends,
        );
      case 'connection_metrics':
        final rtt = data['rttMs'];
        if (rtt is int) {
          state = state.copyWith(rttMs: rtt);
          _socket.updateRtt(rtt);
        }
      case 'device_registered':
        final proto = message['protocolVersion'] as String?;
        state = state.copyWith(
          thisDevice: DeviceInfo.fromJson(data),
          bridgeProtocolVersion: proto,
          protocolBannerDismissed:
              proto != null && proto != state.bridgeProtocolVersion
              ? false
              : null,
        );
      case 'device_connected':
        final device = DeviceInfo.fromJson(data);
        state = state.copyWith(
          connectedDevices: [
            ...state.connectedDevices.where(
              (d) => d.deviceId != device.deviceId,
            ),
            device,
          ],
        );
      case 'device_disconnected':
        final deviceId = data['deviceId'] as String?;
        if (deviceId == null) return;
        state = state.copyWith(
          connectedDevices: state.connectedDevices
              .where((d) => d.deviceId != deviceId)
              .toList(),
        );
    }
  }

  @override
  void dispose() {
    _statusSub?.cancel();
    _messageSub?.cancel();
    super.dispose();
  }
}

final connectionProvider =
    StateNotifierProvider<ConnectionNotifier, BridgeConnectionState>((ref) {
      final socket = ref.watch(webSocketServiceProvider);
      final bridge = ref.watch(bridgeServiceProvider);
      return ConnectionNotifier(ref, socket, bridge);
    });
