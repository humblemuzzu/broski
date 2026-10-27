/// Close codes the daemon ends a link session with, as defined in
/// `packages/link/daemon/src/session/close_codes.rs`.
abstract final class LinkCloseCode {
  static const int normal = 1000;
  static const int shuttingDown = 4001;
  static const int bridgeOverflow = 4002;
  static const int revoked = 4003;
  static const int idleExpired = 4004;
  static const int sessionError = 4005;
}

/// What the machine's close codes mean for one link.
final class PeerClosePolicy {
  int? _code;
  var _revoked = false;

  /// The last close code, kept until a session comes up again so every status
  /// in between carries the reason.
  int? get code => _code;

  bool get isRevoked => _revoked;

  void record(int code) {
    _code = code;
    _revoked = _revoked || code == LinkCloseCode.revoked;
  }

  /// Clears the code and says whether the session that just came up must
  /// resync: a bridge that overflowed forgot this phone's view even when the
  /// link session itself resumed.
  bool takeResync({required bool sessionReset}) {
    final overflowed = _code == LinkCloseCode.bridgeOverflow;
    _code = null;
    return sessionReset || overflowed;
  }
}
