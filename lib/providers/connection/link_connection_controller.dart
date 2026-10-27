import 'dart:async';
import 'dart:developer' as developer;

import 'package:broski/models/link/link_control_exception.dart';
import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/app_info_provider.dart';
import 'package:broski/providers/connection/bridge_reset_fanout.dart';
import 'package:broski/providers/connection/bridge_status_provider.dart';
import 'package:broski/providers/connection/connect_retry_schedule.dart';
import 'package:broski/providers/connection/link_bridge_wiring.dart';
import 'package:broski/providers/connection/link_connect_failure_notice.dart';
import 'package:broski/providers/connection/link_frame_error_notice.dart';
import 'package:broski/providers/connection/link_lan_discovery.dart';
import 'package:broski/providers/connection/link_lan_failure_notice.dart';
import 'package:broski/providers/connection/link_send_failure_notice.dart';
import 'package:broski/providers/connection/link_status_mapping.dart';
import 'package:broski/providers/link/lan_search_provider.dart';
import 'package:broski/providers/link/link_session_start_provider.dart';
import 'package:broski/providers/link/link_status_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/link/push_providers.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_reset_exception.dart';
import 'package:broski/services/link/device_profile.dart';
import 'package:broski/services/link/link_endpoint.dart';
import 'package:broski/services/link/push_registration.dart';
import 'package:broski/services/network_monitor_service.dart';
import 'package:broski/services/websocket/link_transport.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The app's single Broski Link connection.
final linkConnectionControllerProvider = Provider<LinkConnectionController>((
  ref,
) {
  final controller = LinkConnectionController(ref);
  ref.onDispose(controller.dispose);
  return controller;
});

/// Brings the controller up at app start.
final linkConnectionBootstrapProvider = Provider<void>((ref) {
  ref.watch(linkConnectionControllerProvider);
  ref.watch(linkConnectFailureNoticeProvider);
  ref.watch(linkFrameErrorNoticeProvider);
  ref.watch(linkSendFailureNoticeProvider);
  ref.watch(lanBrowseFailureNoticeProvider);
  ref.watch(pushKeyPruneProvider);
});

/// Keeps one [LinkConnection] live for the selected machine and republishes it
/// as the connection the rest of the app sees.
///
/// The link owns route selection, resume and backoff, so nothing here retries
/// or pings: this maps link status onto the app's status stream, answers route
/// changes, and announces this phone on every connection.
class LinkConnectionController with WidgetsBindingObserver {
  LinkConnectionController(this._ref) {
    WidgetsBinding.instance.addObserver(this);
    _statusSink = _ref.read(linkStatusSinkProvider.notifier);
    _bridgeSink = _ref.read(bridgeLinkStatusProvider.notifier);
    _socket = _ref.read(webSocketServiceProvider);
    _networkSub = _ref
        .read(networkMonitorServiceProvider)
        .stateStream
        .listen(_onNetworkChange);
    _machinesSub = _ref.listen<MachinesState>(machinesProvider, (_, next) {
      _maybeConnect(next);
      _syncLanSearch();
    }, fireImmediately: true);
  }

  static const _logName = 'LinkConnection';

  final Ref _ref;
  late final LinkStatusSink _statusSink;
  late final BridgeLinkStatusSink _bridgeSink;
  late final WebSocketService _socket;
  late final LinkStatusPublisher _publisher = LinkStatusPublisher(
    publish: _socket.applyTransportStatus,
    onConnected: () => unawaited(_announce()),
  );
  late final LinkBridgeWiring _wiring = LinkBridgeWiring(
    publisher: _publisher,
    sink: _bridgeSink,
    onReset: _onBridgeReset,
    onRefused: (requestId, reason) =>
        _ref.read(bridgeResetFanoutProvider).refuse(requestId, reason),
    announcements: _sendFailures,
  );
  final StreamController<LinkSendFailure> _sendFailures =
      StreamController<LinkSendFailure>.broadcast();
  final StreamController<Object> _connectFailures =
      StreamController<Object>.broadcast();
  final ConnectRetrySchedule _retry = ConnectRetrySchedule();
  late final LinkLanDiscovery _lan = LinkLanDiscovery(
    ref: _ref,
    pushEndpoint: _pushEndpoint,
    timing: _ref.read(lanSearchTimingProvider),
  );

  ProviderSubscription<MachinesState>? _machinesSub;
  StreamSubscription<NetworkState>? _networkSub;
  StreamSubscription<LinkStatus>? _statusSub;
  StreamSubscription<Map<String, Object?>>? _controlSub;
  StreamSubscription<BridgeLinkStatus>? _bridgeSub;
  StreamSubscription<LinkSendFailure>? _sendFailureSub;
  LinkSession? _connection;
  Machine? _machine;
  LinkStatus? _lastStatus;
  PushRegistration? _push;
  var _attached = false;

  /// A browse costs the radio, so it runs only while the app can act on what it
  /// finds. `inactive` is a call or a permission prompt: still in front.
  var _foreground = true;

  /// Bumped whenever the current connection is released, so a connect still
  /// dialling when that happens closes what it opened instead of adopting it.
  var _epoch = 0;

  /// Set once per link session: a machine's last-connected time is written once,
  /// not on every status the link reports.
  var _touched = false;

  /// A connect is dialling: nothing else may start one until it lands or fails.
  var _connecting = false;
  Timer? _retryTimer;

  /// A pairing owns the connection, so the auto-connect does not start a second
  /// link for the machine the QR is about to store.
  var _pairing = false;

  /// Messages the user sent that the link refused, for the notice the app shows.
  Stream<LinkSendFailure> get sendFailures => _sendFailures.stream;

  /// Connects that never reached the link at all, with the reason.
  Stream<Object> get connectFailures => _connectFailures.stream;

  /// A browse that could not run, once. The app tells the user, because nothing
  /// else will find their machine on the LAN until they allow it.
  Stream<Object> get discoveryFailures => _lan.failures;

  /// One control message to the daemon, for example a bridge restart.
  void sendControl(Map<String, Object?> message) =>
      _connection?.sendControl(message);

  void beginPairing() {
    _pairing = true;
    _syncLanSearch();
  }

  void endPairing() {
    _pairing = false;
    _syncLanSearch();
  }

  /// Takes over a connection that is already up.
  ///
  /// [connected] says whether the link has already reached the machine, which
  /// is the case when a pairing hands its live connection over.
  Future<void> adopt(
    LinkSession connection,
    Machine machine, {
    required bool connected,
  }) async {
    _release();
    _retry.reset();
    _connection = connection;
    _machine = machine;
    _statusSub = connection.status.listen(_onStatus);
    _controlSub = connection.control.listen(_onControl);
    _bridgeSub = connection.bridgeStatus.listen(_onBridgeStatus);
    _sendFailureSub = connection.sendFailures.listen(_onSendFailure);
    await _socket.connect(
      LinkTransport(
        messages: connection.bridgeMessages,
        send: connection.sendBridge,
      ),
    );
    _attached = true;
    final status = _lastStatus;
    if (status != null) {
      _publisher.add(status);
      _wiring.onLinkStatus(status);
    } else if (connected) {
      const reset = LinkStatus(state: LinkConnectionState.connected);
      _publisher.add(reset);
      _wiring.onLinkStatus(reset);
    }
    _syncLanSearch();
  }

  void _maybeConnect(MachinesState state) {
    if (_pairing) return;
    final id = state.selectedId;
    if (id == null) {
      if (_connection != null) {
        _detach();
        unawaited(_socket.disconnect());
      }
      return;
    }
    if (_connection != null || _connecting) return;
    final machine = machineWithId(state.machines, id);
    if (machine == null) return;
    unawaited(_connect(machine));
  }

  /// Moves the app's single link onto [machine], closing the link it replaces
  /// first so two machines are never connected at once.
  Future<void> switchTo(Machine machine) async {
    if (_connection != null && _machine?.id == machine.id) return;
    _detach();
    await _connect(machine);
  }

  Future<void> _connect(Machine machine) async {
    final epoch = ++_epoch;
    _connecting = true;
    _retryTimer?.cancel();
    _retryTimer = null;
    try {
      final identity = await _ref.read(deviceIdentityProvider.future);
      if (epoch != _epoch) return;
      final connection = await _ref.read(linkSessionStarterProvider)(
        identitySecret: identity.secret,
        endpoint: linkEndpoint(machine, deviceId: identity.id),
      );
      if (epoch != _epoch) {
        unawaited(connection.close());
        return;
      }
      await adopt(connection, machine, connected: false);
    } on Object catch (error, stackTrace) {
      if (epoch != _epoch) return;
      _onConnectFailed(machine, error, stackTrace);
    }
  }

  /// Nothing is dialling after this, so the app is told so — with the reason —
  /// and one more attempt is scheduled, doubling up to a bounded delay.
  void _onConnectFailed(Machine machine, Object error, StackTrace stackTrace) {
    developer.log(
      'link connect failed',
      name: _logName,
      error: error,
      stackTrace: stackTrace,
    );
    _connecting = false;
    _publisher.reset();
    _socket.applyTransportStatus(ConnectionStatus.disconnected);
    _statusSink.clear();
    if (!_connectFailures.isClosed) _connectFailures.add(error);
    _syncLanSearch();
    _retryTimer?.cancel();
    _retryTimer = Timer(_retry.next(), () {
      _retryTimer = null;
      _maybeConnect(_ref.read(machinesProvider));
    });
  }

  void _onStatus(LinkStatus status) {
    _lastStatus = status;
    final machine = _machine;
    if (machine != null) {
      _statusSink.publish(machine.id, status);
    }
    if (_attached) {
      _publisher.add(status);
      _wiring.onLinkStatus(status);
    }
    _lanSearchFor(status);
    // A closed link must not hold the slot: the next resume or network change
    // has to be able to start a fresh one.
    if (status.state == LinkConnectionState.closed) {
      _detach();
    }
  }

  Future<void> _announce() async {
    final connection = _connection;
    final machine = _machine;
    if (connection == null || machine == null) return;
    connection.sendControl(helloControl(app: _ref.read(appVersionProvider)));
    final identity = await _ref.read(deviceIdentityProvider.future);
    unawaited(
      _pushRegistration.onConnected(
        machine,
        identity.id,
        connection.sendControl,
      ),
    );
    if (_touched) return;
    _touched = true;
    await _ref
        .read(machinesProvider.notifier)
        .touchConnected(machine.id, DateTime.now());
  }

  void _onBridgeStatus(BridgeLinkStatus status) =>
      _wiring.onBridgeStatus(status);

  void _onSendFailure(LinkSendFailure failure) =>
      _wiring.onSendFailure(failure);

  /// A reset means the bridge forgot what it was asked, so a request still
  /// waiting for a reply will never see one.
  void _onBridgeReset(BridgeResetReason reason) {
    _ref.read(bridgeResetFanoutProvider).failAll(reason);
  }

  void _onControl(Map<String, Object?> message) {
    if (message['t'] != 'routes') return;
    final machine = _machine;
    if (machine == null) return;
    unawaited(_applyRoutes(machine.id, message));
  }

  /// Built on first use, so a controller that never connects never opens the
  /// keychain-backed store.
  PushRegistration get _pushRegistration {
    final existing = _push;
    if (existing != null) return existing;
    final created = _ref.read(pushRegistrationProvider);
    _push = created;
    return created;
  }

  Future<void> _applyRoutes(
    String machineId,
    Map<String, Object?> routes,
  ) async {
    try {
      await _ref.read(machinesProvider.notifier).applyRoutes(machineId, routes);
    } on LinkControlException catch (error) {
      developer.log('link routes refused: ${error.message}', name: _logName);
      return;
    }
    final machine = machineWithId(
      _ref.read(machinesProvider).machines,
      machineId,
    );
    if (machine == null) return;
    _machine = machine;
    final identity = await _ref.read(deviceIdentityProvider.future);
    _connection?.updateEndpoint(linkEndpoint(machine, deviceId: identity.id));
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
      case AppLifecycleState.detached:
        _foreground = false;
        _connection?.appPaused();
      case AppLifecycleState.resumed:
        _foreground = true;
        _connection?.appResumed();
        // A link that never came up — the isolate died, the machine was stored
        // by a pairing this controller never saw — gets another start.
        _maybeConnect(_ref.read(machinesProvider));
      case AppLifecycleState.inactive:
        break;
    }
    _syncLanSearch();
  }

  void _onNetworkChange(NetworkState state) {
    if (state == NetworkState.none || state == NetworkState.unknown) return;
    final connection = _connection;
    if (connection == null) {
      _maybeConnect(_ref.read(machinesProvider));
      _syncLanSearch();
      return;
    }
    connection.networkChanged();
    _syncLanSearch();
  }

  /// Runs one browse for as long as it can help, and none when it cannot.
  ///
  /// The advert is only a hint: the Noise handshake authenticates the machine on
  /// the socket itself, so a wrong or spoofed advert costs a dial and nothing
  /// else. What answers is written to the record, so the next connect tries it
  /// first. The sync lands on a microtask because the browse state is a provider,
  /// and this runs from inside this provider's own initialisation.
  void _syncLanSearch() => _lanSearchFor(_lastStatus);

  /// [status] is read now, not when the microtask runs: releasing a connection
  /// clears the last status, and a closed link must not come back as "no status
  /// yet, look for the machine".
  void _lanSearchFor(LinkStatus? status) =>
      scheduleMicrotask(() => _applyLanSearch(status));

  void _applyLanSearch(LinkStatus? status) {
    final machines = _ref.read(machinesProvider);
    _lan.update(
      machine: machineWithId(machines.machines, machines.selectedId ?? ''),
      status: status,
      foreground: _foreground && !_pairing,
    );
  }

  /// Dials [machine]'s routes as they now stand, which is what makes a freshly
  /// discovered address reach the link without waiting out its backoff.
  Future<void> _pushEndpoint(Machine machine) async {
    if (_machine?.id != machine.id) return;
    _machine = machine;
    final identity = await _ref.read(deviceIdentityProvider.future);
    _connection?.updateEndpoint(linkEndpoint(machine, deviceId: identity.id));
  }

  /// Drops the connection in use and supersedes anything still dialling.
  void _detach() {
    _epoch++;
    _release();
  }

  void _release() {
    _attached = false;
    _touched = false;
    _connecting = false;
    _lastStatus = null;
    _retryTimer?.cancel();
    _retryTimer = null;
    _push?.detach();
    _statusSink.clear();
    _publisher.reset();
    _wiring.reset();
    _bridgeSink.publish(null);
    _statusSub?.cancel();
    _controlSub?.cancel();
    _bridgeSub?.cancel();
    _sendFailureSub?.cancel();
    _statusSub = null;
    _controlSub = null;
    _bridgeSub = null;
    _sendFailureSub = null;
    _machine = null;
    final connection = _connection;
    _connection = null;
    if (connection != null) {
      unawaited(connection.close());
    }
  }

  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _machinesSub?.close();
    _networkSub?.cancel();
    _detach();
    _lan.dispose();
    unawaited(_sendFailures.close());
    unawaited(_connectFailures.close());
  }
}
