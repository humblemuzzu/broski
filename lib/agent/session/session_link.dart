import 'package:broski/contract/generated/contract.dart';

/// Where the phone stands with one session's event stream (contract §12.2).
/// [resume] in each state is the last position applied, if any: a reattach
/// sends it so the bridge can replay what was missed.
sealed class SessionLink {
  const SessionLink();
}

/// Not attached: before the first attach, until the connection is back, or
/// until an attach the bridge could not serve is tried again ([problem]).
final class LinkWaiting extends SessionLink {
  const LinkWaiting([this.resume, this.problem]);

  final StreamPosition? resume;

  /// Why the last attach failed; it is tried again after a wait.
  final String? problem;
}

/// An attach is on its way. Events that arrive meanwhile wait for its answer
/// (`HeldEvents`), so each applies against the position it was sent after.
final class LinkAttaching extends SessionLink {
  const LinkAttaching([this.resume]);

  final StreamPosition? resume;
}

final class LinkLive extends SessionLink {
  const LinkLive(this.position);

  final StreamPosition position;
}

/// The session cannot be followed: it was deleted, or the bridge no longer
/// knows it. Nothing reattaches it but the person.
final class LinkLost extends SessionLink {
  const LinkLost(this.reason);

  final String reason;
}

/// The live session goes on as [next] (`session_replaced`, contract §7).
final class LinkReplaced extends SessionLink {
  const LinkReplaced(this.next);

  final SessionRef next;
}

StreamPosition? positionOf(SessionLink link) => switch (link) {
  LinkLive(:final position) => position,
  LinkAttaching(:final resume) || LinkWaiting(:final resume) => resume,
  LinkLost() || LinkReplaced() => null,
};
