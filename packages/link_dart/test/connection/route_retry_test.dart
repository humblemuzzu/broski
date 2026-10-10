import 'package:broski_link/src/connection/backoff.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:broski_link/src/connection/route_retry.dart';
import 'package:test/test.dart';

void main() {
  test('the first failure switches route at once, the rest back off', () {
    final retry = RouteRetry(
      hasRoute: (route) => true,
      backoff: Backoff(random: () => 0.5),
    );

    expect(retry.next(LinkRoute.lan), (
      only: LinkRoute.relay,
      delay: Duration.zero,
    ));
    expect(retry.next(LinkRoute.relay), (
      only: null,
      delay: const Duration(milliseconds: 500),
    ));
    expect(retry.next(LinkRoute.lan), (
      only: null,
      delay: const Duration(seconds: 1),
    ));

    retry.reset();
    expect(retry.next(null), (only: LinkRoute.lan, delay: Duration.zero));
  });

  test('an unconfigured other route backs off instead of switching', () {
    final retry = RouteRetry(
      hasRoute: (route) => route == LinkRoute.lan,
      backoff: Backoff(random: () => 0.5),
    );

    expect(retry.next(LinkRoute.lan), (
      only: null,
      delay: const Duration(milliseconds: 500),
    ));
    expect(retry.next(null), (only: null, delay: const Duration(seconds: 1)));
  });
}
