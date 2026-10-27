import 'package:broski_link/broski_link.dart';

/// Two browses an hour is plenty for a machine that has not moved; a browse
/// costs the radio and a platform call, and every retry would otherwise start one.
const linkDiscoveryInterval = Duration(minutes: 30);

/// A link already carrying LAN needs nothing: it is on the route discovery would
/// find. Everything else — retrying after a failure, no socket at all, or a
/// machine the relay reports offline — is a case where the addresses in the
/// record are missing or stale.
bool browseHelps({required bool connected, required LinkRoute? route}) =>
    !(connected && route == LinkRoute.lan);

/// Collapses every reason to look — a failure, a network change, a resume — into
/// one browse per [interval].
final class DiscoveryScheduler {
  DiscoveryScheduler({
    required this.clock,
    this.interval = linkDiscoveryInterval,
  });

  final Duration Function() clock;
  final Duration interval;

  Duration? _lastRun;

  bool due() {
    final last = _lastRun;
    return last == null || clock() - last >= interval;
  }

  void record() => _lastRun = clock();
}
