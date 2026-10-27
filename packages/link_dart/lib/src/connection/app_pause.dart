/// How long a socket that survived an app pause is still worth reusing.
const Duration _staleSocketAfter = Duration(seconds: 15);

/// The app's own pause, as the link sees it: nothing dials while paused, and a
/// quick resume keeps the socket that was already open.
final class AppPause {
  AppPause(this._now);

  final Duration Function() _now;

  var _paused = false;
  Duration? _pausedAt;

  bool get paused => _paused;

  void pause() {
    if (_paused) return;
    _paused = true;
    _pausedAt = _now();
  }

  /// True when the resume may reuse a socket that is still open: the app was
  /// not away long enough for the peer to have dropped it silently.
  bool resume() {
    if (!_paused) return false;
    final away = _now() - (_pausedAt ?? Duration.zero);
    _paused = false;
    _pausedAt = null;
    return away <= _staleSocketAfter;
  }
}
