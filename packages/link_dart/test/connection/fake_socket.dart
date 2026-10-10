import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:broski_link/src/connection/link_socket.dart';
import 'package:broski_link/src/connection/link_status.dart';

/// A socket the test opens, keeps or kills by hand.
final class FakeSocket implements LinkSocket {
  FakeSocket(this.route, this.uri);

  @override
  final LinkRoute route;

  @override
  final Uri uri;

  var closed = false;
  var _open = true;
  void Function()? onClosed;

  @override
  bool get isOpen => _open;

  @override
  void listen(
    void Function(SocketFrame frame) onFrame,
    void Function() onClosedHandler,
  ) {
    onClosed = onClosedHandler;
  }

  @override
  void send(Uint8List bytes) {}

  @override
  Future<void> close() async {
    closed = true;
    _open = false;
  }

  void die() {
    _open = false;
    onClosed?.call();
  }
}

/// One dial per attempt, completed by the test.
final class Dial {
  Dial(this.socket);

  final FakeSocket socket;
  final List<Completer<FakeSocket>> attempts = [];
  final List<Duration> timeouts = [];

  int get started => attempts.length;

  Future<LinkSocket> call({
    required Uri uri,
    required LinkRoute route,
    required Duration timeout,
  }) {
    timeouts.add(timeout);
    final attempt = Completer<FakeSocket>();
    attempts.add(attempt);
    return attempt.future;
  }

  void open([int index = 0]) => attempts[index].complete(socket);

  void fail([int index = 0]) =>
      attempts[index].completeError(const SocketException('nope'));
}
