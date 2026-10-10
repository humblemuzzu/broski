import 'dart:async';

import 'package:broski_link/src/connection/link_status.dart';

/// Times one handshake attempt: the deadline for the connect frame to answer,
/// and, before that frame goes out, the window the relay gets to report the
/// machine.
final class LinkHandshake {
  LinkHandshake({
    required void Function() onTimeout,
    required void Function(LinkConnectionState state) onState,
    this.frameTimeout = const Duration(seconds: 8),
    this.presenceTimeout = const Duration(seconds: 10),
  }) : _onTimeout = onTimeout,
       _onState = onState;

  final void Function() _onTimeout;
  final void Function(LinkConnectionState state) _onState;
  final Duration frameTimeout;
  final Duration presenceTimeout;

  Timer? _frame;
  Timer? _presence;
  var _sent = false;

  /// Whether the connect frame has gone out on the current socket.
  bool get sent => _sent;

  /// Starts a fresh attempt; the caller sends the connect frame next.
  void begin() {
    _presence?.cancel();
    _presence = null;
    _frame?.cancel();
    _frame = Timer(frameTimeout, _frameTimedOut);
    _sent = true;
    _onState(LinkConnectionState.connecting);
  }

  /// Waits [presenceTimeout] for the relay to report the machine.
  void awaitPresence() {
    _onState(LinkConnectionState.connecting);
    _presence = Timer(presenceTimeout, _presenceTimedOut);
  }

  /// The relay reported the machine, so its deadline no longer applies.
  void presenceReported() {
    _presence?.cancel();
    _presence = null;
  }

  /// Forgets that a connect frame went out; the deadlines are left alone.
  void reset() => _sent = false;

  /// Drops both deadlines, keeping [sent] as it is.
  void cancel() {
    _frame?.cancel();
    _frame = null;
    _presence?.cancel();
    _presence = null;
  }

  void _frameTimedOut() {
    _frame = null;
    _onTimeout();
  }

  void _presenceTimedOut() {
    _presence = null;
    _onTimeout();
  }
}
