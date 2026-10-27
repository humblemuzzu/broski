import 'dart:async';
import 'dart:isolate';
import 'dart:typed_data';

import 'package:broski_link/src/connection/app_pause.dart';
import 'package:broski_link/src/connection/isolate_protocol.dart';
import 'package:broski_link/src/connection/lan_probe.dart';
import 'package:broski_link/src/connection/link_close_code.dart';
import 'package:broski_link/src/connection/link_handshake.dart';
import 'package:broski_link/src/connection/link_session_io.dart';
import 'package:broski_link/src/connection/link_socket.dart';
import 'package:broski_link/src/connection/link_sockets.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:broski_link/src/connection/link_status_reporter.dart';
import 'package:broski_link/src/connection/machine_endpoint.dart';
import 'package:broski_link/src/connection/presence_tracker.dart';
import 'package:broski_link/src/connection/retry_schedule.dart';
import 'package:broski_link/src/connection/route_retry.dart';
import 'package:broski_link/src/connection/web_link_socket.dart';

/// The isolate side of a link connection: it owns the sessions, the routes, the
/// retry policy and the clock.
///
/// [LinkConnectionState.connecting] means a socket is open and a handshake is
/// in flight. [LinkConnectionState.waiting] means no socket is open: a retry is
/// scheduled, the app is paused, or nothing has been tried yet.
final class LinkEngine {
  LinkEngine({
    required this.events,
    required this.commands,
    required Uint8List identitySecret,
    required MachineEndpoint endpoint,
    Uint8List? pairingSecret,
  }) : _endpoint = endpoint,
       _identitySecret = identitySecret {
    _io = _newIo(pairingSecret);
    _sockets = LinkSockets(
      dial: _dial,
      onFrame: _onFrame,
      onLost: _onSocketLost,
    );
    _probe = LanProbe(
      dial: _sockets.open,
      onOpened: _migrate,
      clock: () => _now,
    );
    _status = LinkStatusReporter(events);
    _retries = RouteRetry(
      hasRoute: (route) => LinkSockets.hasRoute(_endpoint, route),
    );
    _handshake = LinkHandshake(onTimeout: _onFailure, onState: _setState);
    _retrySchedule = RetrySchedule(connect: (only) => _connect(only: only));
    _pause = AppPause(() => _now);
  }

  /// Events to the main isolate.
  final SendPort events;

  /// Commands from the main isolate; closed by [shutdown].
  final ReceivePort commands;

  final Stopwatch _clock = Stopwatch()..start();
  final PresenceTracker _presence = PresenceTracker();
  final Uint8List _identitySecret;

  late LinkSessionIo _io;
  late final LinkSockets _sockets;
  late final LanProbe _probe;
  late final LinkStatusReporter _status;
  late final RouteRetry _retries;
  late final LinkHandshake _handshake;
  late final RetrySchedule _retrySchedule;
  late final AppPause _pause;

  MachineEndpoint _endpoint;
  var _closed = false;
  final PeerClosePolicy _close = PeerClosePolicy();

  Duration get _now => Duration(milliseconds: _clock.elapsedMilliseconds);

  /// Starts the first attempt.
  void run() => _connect();

  void handle(LinkCommand command) {
    if (_closed) {
      return;
    }
    switch (command) {
      case LinkSendBridge(:final stream, :final bytes, :final tag):
        _io.send(stream, bytes, tag: tag);
      case LinkSetEndpoint(:final endpoint):
        _setEndpoint(endpoint);
      case LinkNetworkChanged():
        _reconnectNow();
      case LinkAppResumed():
        _resumeApp();
      case LinkAppPaused():
        _pauseApp();
      case LinkShutdown():
        unawaited(shutdown());
    }
  }

  /// Closes every socket, tells the app, then lets the isolate exit.
  Future<void> shutdown() async {
    if (_closed) {
      return;
    }
    _closed = true;
    _retrySchedule.cancel();
    _handshake.cancel();
    _probe.stop();
    _io.stop();
    await _sockets.closeAll();
    _presence.clear();
    _setState(LinkConnectionState.closed);
    events.send(const LinkIsolateStopped());
    commands.close();
  }

  LinkSessionIo _newIo(Uint8List? pairingSecret) => LinkSessionIo(
    identitySecret: _identitySecret,
    serverBundle: _endpoint.serverPublicBundle,
    pairingSecret: pairingSecret,
    onWire: (wire) => _sockets.current?.send(wire),
    onConnected: _onConnected,
    onBridge: (text) => events.send(LinkIsolateBridge(text)),
    onControl: (message) => events.send(LinkIsolateControl(message)),
    onFailed: _onFailure,
    onPeerClosed: _onPeerClosed,
    onSendFailure: (failure) => events.send(LinkIsolateSendFailure(failure)),
  );

  void _setEndpoint(MachineEndpoint endpoint) {
    final sameMachine = endpoint.isSameMachine(_endpoint);
    final routesChanged = !_sameRoutes(_endpoint, endpoint);
    _endpoint = endpoint;
    if (!sameMachine) {
      // A different machine or bundle pins a different key, so the session goes.
      _io.stop();
      _io = _newIo(null);
      _reconnectNow();
      return;
    }
    if (_status.state == LinkConnectionState.connected) {
      _syncProbe();
      return;
    }
    if (routesChanged || _status.state == LinkConnectionState.waiting) {
      _reconnectNow();
      return;
    }
    _syncProbe();
  }

  /// Whether [next] dials the same candidates as [previous]: an endpoint the
  /// record re-reports unchanged is not a reason to abandon an attempt.
  static bool _sameRoutes(MachineEndpoint previous, MachineEndpoint next) =>
      _sameList(previous.lan, next.lan) &&
      previous.relayDevice()?.toString() == next.relayDevice()?.toString() &&
      previous.relayToken == next.relayToken;

  static bool _sameList(List<String> left, List<String> right) {
    if (left.length != right.length) {
      return false;
    }
    for (var index = 0; index < left.length; index++) {
      if (left[index] != right[index]) {
        return false;
      }
    }
    return true;
  }

  void _connect({LinkRoute? only}) {
    if (_closed || _close.isRevoked) {
      return;
    }
    _retrySchedule.cancel();
    _handshake.cancel();
    _handshake.reset();
    _sockets.stop();
    _presence.clear();
    _io.detach();
    _setState(LinkConnectionState.connecting);
    _sockets.start(
      endpoint: _endpoint,
      only: only,
      onChosen: _onChosen,
      onExhausted: _onFailure,
    );
  }

  Future<LinkSocket> _dial({
    required Uri uri,
    required LinkRoute route,
    required Duration timeout,
  }) => dialSocket(
    uri: uri,
    route: route,
    timeout: timeout,
    headers: route == LinkRoute.relay ? _endpoint.relayHeaders() : null,
  );

  void _onChosen(LinkSocket socket) {
    if (_closed) {
      _sockets.stop();
      return;
    }
    if (_pause.paused) {
      // A dial that was already in flight when the app paused: the socket waits
      // here and a quick resume picks it up instead of dialling again.
      return;
    }
    _attach(socket);
  }

  void _attach(LinkSocket socket) {
    _handshake.reset();
    if (socket.route == LinkRoute.lan) {
      _startHandshake(socket);
      return;
    }
    switch (_presence.of(socket)) {
      case MachinePresence.online:
        _startHandshake(socket);
      case MachinePresence.offline:
        _setState(LinkConnectionState.machineOffline);
      case MachinePresence.asleep:
        _setState(LinkConnectionState.machineAsleep);
      case null:
        _handshake.awaitPresence();
    }
  }

  void _startHandshake(LinkSocket socket) {
    _handshake.begin();
    socket.send(_io.connect());
  }

  void _onConnected(bool resumed, bool sessionReset) {
    _handshake.cancel();
    _retries.reset();
    _sockets.dropFallback();
    _setState(
      LinkConnectionState.connected,
      resumed: resumed,
      sessionReset: _close.takeResync(sessionReset: sessionReset),
    );
  }

  void _onPeerClosed(int code) {
    _close.record(code);
    if (!_close.isRevoked) {
      _onFailure();
      return;
    }
    _handshake.cancel();
    _probe.stop();
    _io.stop();
    _sockets.stop();
    _presence.clear();
    _setState(LinkConnectionState.closed);
  }

  void _onFailure() {
    if (_closed || _pause.paused) {
      _sockets.stop();
      return;
    }
    _io.detach();
    _handshake.cancel();
    final fallback = _sockets.takeFallback();
    final route = _sockets.route;
    _sockets.stop();
    if (fallback != null && fallback.isOpen) {
      _sockets.migrateTo(fallback);
      _attach(fallback);
      return;
    }
    final retry = _retries.next(route);
    _setState(LinkConnectionState.waiting);
    _retrySchedule.after(retry.delay, only: retry.only);
  }

  void _reconnectNow() {
    if (_closed || _pause.paused || _close.isRevoked) {
      return;
    }
    _retrySchedule.cancel();
    _retries.reset();
    _connect();
  }

  void _pauseApp() {
    if (_closed || _pause.paused) {
      return;
    }
    _pause.pause();
    _retrySchedule.cancel();
    _handshake.cancel();
    _io.detach();
    _sockets.stop();
    _setState(LinkConnectionState.waiting);
  }

  void _resumeApp() {
    if (_closed || !_pause.paused) {
      return;
    }
    final reusable = _pause.resume();
    final socket = _sockets.current;
    if (reusable && socket != null && socket.isOpen) {
      _retries.reset();
      _attach(socket);
      return;
    }
    _reconnectNow();
  }

  void _onFrame(LinkSocket socket, SocketFrame frame) {
    switch (frame) {
      case SocketBinary(:final bytes):
        if (_handshake.sent && identical(socket, _sockets.current)) {
          _io.handle(bytes);
        }
      case SocketPresence(:final presence, :final lastSeen):
        _onPresence(socket, presence, lastSeen);
    }
  }

  void _onPresence(
    LinkSocket socket,
    MachinePresence presence,
    DateTime? lastSeen,
  ) {
    _presence.record(socket, presence);
    _status.sawMachine(lastSeen);
    if (_closed || _pause.paused || !identical(socket, _sockets.current)) {
      return;
    }
    _handshake.presenceReported();
    switch (presence) {
      case MachinePresence.online:
        if (!_handshake.sent) {
          _startHandshake(socket);
        }
      case MachinePresence.offline:
        _machineGone(LinkConnectionState.machineOffline);
      case MachinePresence.asleep:
        _machineGone(LinkConnectionState.machineAsleep);
    }
  }

  void _machineGone(LinkConnectionState state) {
    _io.detach();
    _handshake.cancel();
    _handshake.reset();
    _setState(state);
  }

  void _onSocketLost() {
    if (_closed) {
      return;
    }
    if (_pause.paused) {
      _sockets.forget();
      return;
    }
    _onFailure();
  }

  void _migrate(LinkSocket socket) {
    _sockets.migrateTo(socket);
    _attach(socket);
  }

  void _syncProbe() => _probe.sync(
    eligible: !_closed && !_pause.paused && _sockets.route == LinkRoute.relay,
    hosts: <Uri>[for (final host in _endpoint.lan) _endpoint.lanLink(host)],
  );

  void _setState(
    LinkConnectionState state, {
    bool? resumed,
    bool sessionReset = false,
  }) {
    _syncProbe();
    _status.report(
      state,
      route: _sockets.route,
      routeDetail: _sockets.detail,
      resumed: resumed,
      sessionReset: sessionReset,
      closeCode: _close.code,
    );
  }
}
