import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:broski_link/src/client.dart';
import 'package:broski_link/src/connection/link_outbound_queue.dart';
import 'package:broski_link/src/connection/link_send_failure.dart';
import 'package:broski_link/src/errors.dart';
import 'package:broski_link/src/events.dart';
import 'package:broski_link/src/identity.dart';

/// Owns the Rust client: handshakes, sealed frames, the link timer and the
/// stream split. Wire bytes leave through [onWire]; the socket belongs to the
/// engine.
/// 0 is control JSON, 1 is bridge messages.
final class LinkSessionIo {
  static const int _controlStream = 0;
  static const int _bridgeStream = 1;

  LinkSessionIo({
    required Uint8List identitySecret,
    required Uint8List serverBundle,
    required this.onWire,
    required this.onConnected,
    required this.onBridge,
    required this.onControl,
    required this.onFailed,
    required this.onPeerClosed,
    required this.onSendFailure,
    Uint8List? pairingSecret,
  }) : _pairingSecret = pairingSecret,
       _client = LinkClient(
         identity: LinkIdentity.fromSecret(identitySecret),
         serverBundle: serverBundle,
       ) {
    _outbound = LinkOutboundQueue(
      sendFrame: (stream, bytes) => _client.send(stream, bytes, nowMs: _now),
      report: onSendFailure,
    );
  }

  final LinkClient _client;
  final Stopwatch _clock = Stopwatch()..start();
  final void Function(Uint8List wire) onWire;
  final void Function(bool resumed, bool sessionReset) onConnected;
  final void Function(String text) onBridge;
  final void Function(Map<String, Object?> message) onControl;
  final void Function() onFailed;
  final void Function(int code) onPeerClosed;
  final void Function(LinkSendFailure failure) onSendFailure;

  late final LinkOutboundQueue _outbound;
  Uint8List? _pairingSecret;
  Timer? _timer;
  var _hasSession = false;
  var _pumping = false;

  /// Starts a handshake and returns msg1 for the socket.
  Uint8List connect() {
    // The pairing secret survives until a handshake completes, so a socket
    // that dies mid-Pair is retried in Pair mode.
    final msg1 = _client.connect(pairingSecret: _pairingSecret, nowMs: _now);
    _pump();
    return msg1;
  }

  /// One message for the session, waiting here while it cannot take it; [tag]
  /// comes back on the failure if it never goes out.
  void send(int stream, Uint8List bytes, {String? tag}) {
    _outbound.send(stream, bytes, tag: tag);
    _pump();
  }

  /// One whole wire message: msg2 first, then one sealed frame per message.
  void handle(Uint8List wire) {
    try {
      _client.handle(wire, nowMs: _now);
    } on LinkException {
      onFailed();
      return;
    }
    _pump();
  }

  /// The socket is gone; the session survives for the next [connect].
  void detach() {
    _timer?.cancel();
    _timer = null;
    // Waiting here, not inside the session: a session the peer replaces drops
    // its own buffer without a word, while this queue is bounded and reported.
    _outbound.ready = false;
    _client.disconnect();
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    _outbound.ready = false;
  }

  int get _now => _clock.elapsedMilliseconds;

  void _pump() {
    if (_pumping) {
      return;
    }
    _pumping = true;
    try {
      _drainEvents();
      _outbound.pump();
      _drainTransmit();
      _schedule();
    } finally {
      _pumping = false;
    }
  }

  void _drainTransmit() {
    while (true) {
      final wire = _client.pollTransmit();
      if (wire == null) {
        return;
      }
      onWire(wire);
    }
  }

  void _drainEvents() {
    while (true) {
      final event = _client.pollEvent();
      if (event == null) {
        return;
      }
      switch (event) {
        case LinkConnected(resumed: final resumed):
          final reset = !resumed && _hasSession;
          _hasSession = true;
          _pairingSecret = null;
          if (reset) {
            _outbound.reset();
          }
          _outbound.ready = true;
          onConnected(resumed, reset);
        case LinkMessage(stream: final stream, bytes: final bytes):
          _deliver(stream, bytes);
        case LinkPeerClosed(code: final code):
          _outbound.ready = false;
          onPeerClosed(code);
          return;
        case LinkDead():
          _outbound.ready = false;
          onFailed();
          return;
      }
    }
  }

  void _deliver(int stream, Uint8List bytes) {
    switch (stream) {
      case _bridgeStream:
        onBridge(utf8.decode(bytes, allowMalformed: true));
      case _controlStream:
        Object? decoded;
        try {
          decoded = jsonDecode(utf8.decode(bytes, allowMalformed: true));
        } on FormatException {
          return;
        }
        if (decoded is Map<String, Object?>) {
          onControl(decoded);
        }
    }
  }

  void _schedule() {
    _timer?.cancel();
    final deadline = _client.pollTimeout();
    if (deadline == null) {
      _timer = null;
      return;
    }
    final delay = deadline - _now;
    _timer = Timer(Duration(milliseconds: delay < 0 ? 0 : delay), _onTimeout);
  }

  void _onTimeout() {
    _timer = null;
    _client.handleTimeout(_now);
    _pump();
  }
}
