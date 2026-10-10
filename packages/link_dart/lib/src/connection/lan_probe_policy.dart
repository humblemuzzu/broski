/// When the next LAN probe may run while the relay carries the link.
///
/// A probe is a single dial per candidate: open the socket, close it again.
/// The policy owns the two durations and hands out one probe slot at a time.
final class LanProbePolicy {
  LanProbePolicy({
    this.interval = const Duration(seconds: 15),
    this.timeout = const Duration(milliseconds: 1500),
  }) : _dueAt = Duration.zero;

  final Duration interval;

  /// How long one candidate may take to answer.
  final Duration timeout;

  /// The instant the next probe may start, or null while one runs.
  Duration? _dueAt;

  Duration? get dueAt => _dueAt;

  /// Claims the probe slot when [now] has reached the due time.
  bool start(Duration now) {
    final due = _dueAt;
    if (due == null || now < due) {
      return false;
    }
    _dueAt = null;
    return true;
  }

  /// Releases the slot and schedules the next probe [interval] later.
  void end(Duration now) => _dueAt = now + interval;

  /// Pulls the next probe forward to [now].
  void resume(Duration now) {
    final due = _dueAt;
    if (due != null && due > now) {
      _dueAt = now;
    }
  }
}
