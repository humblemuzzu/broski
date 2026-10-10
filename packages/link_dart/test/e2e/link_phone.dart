import 'dart:async';
import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

/// The phone half of a link, with every stream buffered from the moment the
/// isolate is up so no status, control message or bridge message is missed.
final class LinkPhone {
  LinkPhone._(this.connection) {
    _statusSub = connection.status.listen(statuses.add);
    _controlSub = connection.control.listen(control.add);
    _bridgeSub = connection.bridgeMessages.listen(_onBridge);
  }

  static Future<LinkPhone> start({
    required LinkIdentity identity,
    required MachineEndpoint endpoint,
    Uint8List? pairingSecret,
  }) async {
    final connection = await LinkConnection.start(
      identitySecret: identity.secret,
      endpoint: endpoint,
      pairingSecret: pairingSecret,
    );
    final phone = LinkPhone._(connection);
    addTearDown(phone.dispose);
    return phone;
  }

  final LinkConnection connection;
  final List<LinkStatus> statuses = <LinkStatus>[];
  final List<Map<String, Object?>> control = <Map<String, Object?>>[];
  final List<String> bridge = <String>[];
  final List<String> _incoming = <String>[];
  final List<Completer<String>> _waiters = <Completer<String>>[];
  late final StreamSubscription<LinkStatus> _statusSub;
  late final StreamSubscription<Map<String, Object?>> _controlSub;
  late final StreamSubscription<String> _bridgeSub;

  int get statusCount => statuses.length;

  void _onBridge(String text) {
    bridge.add(text);
    if (_waiters.isEmpty) {
      _incoming.add(text);
    } else {
      _waiters.removeAt(0).complete(text);
    }
  }

  /// The next bridge message, waiting for one when none has arrived yet.
  Future<String> nextBridge({Duration timeout = const Duration(seconds: 20)}) {
    if (_incoming.isNotEmpty) {
      return Future<String>.value(_incoming.removeAt(0));
    }
    final waiter = Completer<String>();
    _waiters.add(waiter);
    return waiter.future.timeout(
      timeout,
      onTimeout: () {
        _waiters.remove(waiter);
        throw TimeoutException('no bridge message arrived in $timeout');
      },
    );
  }

  void sendBridge(String text) => connection.sendBridge(text);

  void sendControl(Map<String, Object?> message) =>
      connection.sendControl(message);

  void networkChanged() => connection.networkChanged();

  void updateEndpoint(MachineEndpoint endpoint) =>
      connection.updateEndpoint(endpoint);

  /// The first status at or after [from] that matches [test].
  Future<LinkStatus> awaitStatus(
    bool Function(LinkStatus status) test, {
    int from = 0,
    Duration timeout = const Duration(seconds: 20),
    String? reason,
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (true) {
      for (var index = from; index < statuses.length; index++) {
        if (test(statuses[index])) {
          return statuses[index];
        }
      }
      if (DateTime.now().isAfter(deadline)) {
        fail('timed out waiting for ${reason ?? 'a status'}, saw $statuses');
      }
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
  }

  /// The first control message tagged [tag] at or after [from].
  Future<Map<String, Object?>> awaitControl(
    String tag, {
    int from = 0,
    Duration timeout = const Duration(seconds: 20),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (true) {
      for (var index = from; index < control.length; index++) {
        if (control[index]['t'] == tag) {
          return control.removeAt(index);
        }
      }
      if (DateTime.now().isAfter(deadline)) {
        fail('timed out waiting for the $tag control message, saw $control');
      }
      await Future<void>.delayed(const Duration(milliseconds: 5));
    }
  }

  /// The first status at or after [from] that is connected over [route].
  Future<LinkStatus> awaitRoute(
    LinkRoute route, {
    int from = 0,
    Duration timeout = const Duration(seconds: 45),
  }) => awaitStatus(
    (status) =>
        status.state == LinkConnectionState.connected && status.route == route,
    from: from,
    timeout: timeout,
    reason: 'the session moves onto the $route route',
  );

  /// Every `bridge` control state this phone has seen, in order.
  List<String> get bridgeStates => <String>[
    for (final message in control)
      if (message['t'] == 'bridge') '${message['state']}',
  ];

  /// Waits until a `bridge` control message at or after [from] reports [state].
  Future<void> awaitBridgeState(
    String state, {
    int from = 0,
    Duration timeout = const Duration(seconds: 45),
  }) async {
    final deadline = DateTime.now().add(timeout);
    while (true) {
      final states = bridgeStates;
      if (states.length > from && states.sublist(from).contains(state)) {
        return;
      }
      if (DateTime.now().isAfter(deadline)) {
        fail('the phone never reported bridge state $state, saw $states');
      }
      await Future<void>.delayed(const Duration(milliseconds: 20));
    }
  }

  /// One request and its echo, timed.
  Future<Duration> roundTrip(String text) async {
    final echo = nextBridge();
    final watch = Stopwatch()..start();
    sendBridge(text);
    await echo;
    return watch.elapsed;
  }

  Future<void> dispose() async {
    await _statusSub.cancel();
    await _controlSub.cancel();
    await _bridgeSub.cancel();
    await connection.close();
  }
}
