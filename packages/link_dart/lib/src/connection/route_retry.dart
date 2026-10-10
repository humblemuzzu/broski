import 'package:broski_link/src/connection/backoff.dart';
import 'package:broski_link/src/connection/link_status.dart';

/// Decides where the next attempt goes after one failed.
///
/// The first failure after a connect switches to the other configured route at
/// once; every later one waits out a backoff and races both routes again.
final class RouteRetry {
  RouteRetry({required this.hasRoute, Backoff? backoff})
    : _backoff = backoff ?? Backoff();

  /// Whether [route] is configured at all.
  final bool Function(LinkRoute route) hasRoute;
  final Backoff _backoff;
  var _switched = false;

  ({LinkRoute? only, Duration delay}) next(LinkRoute? failed) {
    final other = failed == LinkRoute.lan ? LinkRoute.relay : LinkRoute.lan;
    final switchNow = !_switched && hasRoute(other);
    _switched = true;
    if (switchNow) {
      return (only: other, delay: Duration.zero);
    }
    return (only: null, delay: _backoff.nextDelay());
  }

  /// A connect, or a nudge from the app, restores the free switch.
  void reset() {
    _switched = false;
    _backoff.reset();
  }
}
