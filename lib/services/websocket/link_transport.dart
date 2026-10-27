import 'dart:async';

import 'package:broski/services/websocket/bridge_transport.dart';

/// A [BridgeTransport] over a live Broski Link session.
///
/// Sends go into the link session, which queues and retransmits them across
/// routes, so nothing above it needs a send queue or a heartbeat.
final class LinkTransport implements BridgeTransport {
  LinkTransport({
    required Stream<String> messages,
    required void Function(String text, {String? tag}) send,
  }) : sink = _LinkSink(send) {
    _incoming = messages.listen(_onMessage, onError: _onError, onDone: _onDone);
  }

  @override
  final BridgeSink sink;
  final StreamController<dynamic> _outgoing = StreamController<dynamic>();
  late final StreamSubscription<String> _incoming;

  /// Buffers until the service subscribes: the session may deliver a message
  /// while the service is still attaching.
  @override
  Stream<dynamic> get stream => _outgoing.stream;

  @override
  Future<void> close() async {
    await _incoming.cancel();
    if (!_outgoing.isClosed) {
      await _outgoing.close();
    }
  }

  void _onMessage(String text) {
    if (!_outgoing.isClosed) {
      _outgoing.add(text);
    }
  }

  void _onError(Object error, StackTrace stackTrace) {
    if (!_outgoing.isClosed) {
      _outgoing.addError(error, stackTrace);
    }
  }

  void _onDone() {
    if (!_outgoing.isClosed) {
      _outgoing.close();
    }
  }
}

final class _LinkSink implements BridgeSink {
  _LinkSink(this._send);

  final void Function(String text, {String? tag}) _send;

  @override
  void add(String text, {String? tag}) => _send(text, tag: tag);
}
