import 'dart:async';

import 'package:broski_link/src/connection/link_socket.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:broski_link/src/connection/machine_endpoint.dart';
import 'package:broski_link/src/connection/route_dialer.dart';

/// Owns every socket of one link: the one carrying it, the relay socket kept
/// alive while a LAN socket takes over, and the dialer racing both routes.
final class LinkSockets {
  LinkSockets({
    required LinkSocketDial dial,
    required void Function(LinkSocket socket, SocketFrame frame) onFrame,
    required void Function() onLost,
  }) : _dial = dial,
       _onFrame = onFrame,
       _onLost = onLost {
    _dialer = RouteDialer(dial: open);
  }

  /// Whether [route] is configured on [endpoint] at all.
  static bool hasRoute(MachineEndpoint endpoint, LinkRoute route) =>
      route == LinkRoute.lan
      ? endpoint.lan.isNotEmpty
      : endpoint.relayDevice() != null;

  final LinkSocketDial _dial;
  final void Function(LinkSocket socket, SocketFrame frame) _onFrame;
  final void Function() _onLost;
  late final RouteDialer _dialer;

  LinkSocket? _current;
  LinkSocket? _fallback;

  /// The socket carrying the link, if any.
  LinkSocket? get current => _current;
  LinkRoute? get route => _current?.route;
  String? get detail => _current?.detail;

  /// Takes the relay socket out of the object without closing it.
  LinkSocket? takeFallback() {
    final fallback = _fallback;
    _fallback = null;
    return fallback;
  }

  /// Opens the relay and every LAN candidate and reports the winner.
  void start({
    required MachineEndpoint endpoint,
    LinkRoute? only,
    required void Function(LinkSocket socket) onChosen,
    required void Function() onExhausted,
  }) {
    final lan = only == LinkRoute.relay ? const <String>[] : endpoint.lan;
    final relay = only == LinkRoute.lan ? null : endpoint.relayDevice();
    _dialer.start(
      lan: <Uri>[for (final host in lan) endpoint.lanLink(host)],
      relay: relay,
      onChosen: (socket) {
        _current = socket;
        onChosen(socket);
      },
      onExhausted: onExhausted,
    );
  }

  /// [socket] becomes the current one; the old current waits as the fallback
  /// until the new handshake lands.
  void migrateTo(LinkSocket socket) {
    _fallback = _current;
    _current = socket;
  }

  /// Drops the current socket without closing it, for one that died on its own.
  void forget() => _current = null;

  void dropFallback() {
    final fallback = _fallback;
    _fallback = null;
    unawaited(fallback?.close());
  }

  /// Cancels the race and closes every socket.
  void stop() {
    _dialer.cancel();
    for (final socket in _take()) {
      unawaited(socket.close());
    }
  }

  /// Closes every socket and waits for the close handshakes.
  Future<void> closeAll() async {
    _dialer.cancel();
    for (final socket in _take()) {
      await socket.close();
    }
  }

  List<LinkSocket> _take() {
    final current = _current;
    final fallback = _fallback;
    _current = null;
    _fallback = null;
    return <LinkSocket>[
      if (current != null) current,
      if (fallback != null && !identical(fallback, current)) fallback,
    ];
  }

  /// Opens one socket with its frame reader attached, so nothing it receives
  /// can be missed. The LAN probe hands its socket straight to the engine.
  Future<LinkSocket> open({
    required Uri uri,
    required LinkRoute route,
    required Duration timeout,
  }) async {
    final socket = await _dial(uri: uri, route: route, timeout: timeout);
    socket.listen((frame) => _onFrame(socket, frame), () => _closed(socket));
    return socket;
  }

  void _closed(LinkSocket socket) {
    if (identical(socket, _fallback)) {
      _fallback = null;
      return;
    }
    if (!identical(socket, _current)) {
      _dialer.socketFailed(socket);
      return;
    }
    _onLost();
  }
}
