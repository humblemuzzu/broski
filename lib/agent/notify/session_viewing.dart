import 'package:broski/contract/generated/contract.dart';

/// The sessions whose conversation is on screen. Plain state rather than a
/// notifier: it changes while screens are being built and torn down, and
/// only a notification decision ever reads it.
final class SessionViewing {
  final Map<SessionRef, int> _open = {};

  bool isViewing(SessionRef session) => _open.containsKey(session);

  void opened(SessionRef session) =>
      _open.update(session, (count) => count + 1, ifAbsent: () => 1);

  void closed(SessionRef session) {
    final count = _open[session];
    if (count == null) return;
    if (count == 1) {
      _open.remove(session);
    } else {
      _open[session] = count - 1;
    }
  }
}
