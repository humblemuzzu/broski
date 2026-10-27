import 'package:broski/theme/app_icons.dart';
import 'package:broski/widgets/link/link_status_presentation.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

final _now = DateTime(2026, 3, 17, 14, 30);

LinkStatusView present(
  LinkConnectionState state, {
  LinkRoute? route,
  DateTime? lastSeen,
}) => presentLinkStatus(
  status: LinkStatus(state: state, route: route, lastSeen: lastSeen),
  machineName: 'Studio Mac',
  now: _now,
);

void main() {
  group('presentLinkStatus', () {
    test('a connected machine names the route it is on', () {
      final lan = present(LinkConnectionState.connected, route: LinkRoute.lan);
      expect(lan.label, 'Studio Mac · Local network');
      expect(lan.state, 'Local network');
      expect(lan.tone, LinkStatusTone.ok);
      expect(lan.icon, AppIcons.wifi);

      final relay = present(
        LinkConnectionState.connected,
        route: LinkRoute.relay,
      );
      expect(relay.label, 'Studio Mac · Remote');
      expect(relay.tone, LinkStatusTone.ok);
      expect(relay.icon, AppIcons.globe);
    });

    test('a connected machine with no route yet reads as connected', () {
      final view = present(LinkConnectionState.connected);
      expect(view.label, 'Studio Mac · Connected');
      expect(view.state, 'Connected');
    });

    test('dialling and waiting read as connecting', () {
      for (final state in const [
        LinkConnectionState.connecting,
        LinkConnectionState.waiting,
      ]) {
        final view = present(state, route: LinkRoute.lan);
        expect(view.label, 'Connecting to Studio Mac…', reason: '$state');
        expect(view.state, 'Connecting…', reason: '$state');
        expect(view.tone, LinkStatusTone.pending, reason: '$state');
      }
    });

    test('an asleep machine reports how long ago it was seen', () {
      final view = present(
        LinkConnectionState.machineAsleep,
        lastSeen: _now.subtract(const Duration(minutes: 2)),
      );
      expect(view.label, 'Studio Mac is asleep · since 2m ago');
      expect(view.state, 'Asleep · since 2m ago');
      expect(view.tone, LinkStatusTone.pending);
      expect(view.icon, AppIcons.pause);
    });

    test('an asleep machine nobody has seen makes no claim about when', () {
      final view = present(LinkConnectionState.machineAsleep);
      expect(view.label, 'Studio Mac is asleep');
      expect(view.state, 'Asleep');
    });

    test('an offline machine reports when it was last seen', () {
      final view = present(
        LinkConnectionState.machineOffline,
        lastSeen: _now.subtract(const Duration(hours: 3)),
      );
      expect(view.label, 'Studio Mac is offline · last seen 3h ago');
      expect(view.state, 'Offline · last seen 3h ago');
      expect(view.tone, LinkStatusTone.down);
      expect(view.icon, AppIcons.wifiOff);
    });

    test('an offline machine never seen says so instead', () {
      final view = present(LinkConnectionState.machineOffline);
      expect(view.label, 'Studio Mac is offline · not seen yet');
      expect(view.state, 'Offline · not seen yet');
    });

    test('a closed link is disconnected', () {
      final view = present(LinkConnectionState.closed);
      expect(view.label, 'Disconnected');
      expect(view.state, 'Disconnected');
      expect(view.tone, LinkStatusTone.down);
      expect(view.icon, AppIcons.signalOff);
    });
  });

  test('a link the machine revoked says to pair again', () {
    final view = presentLinkStatus(
      status: const LinkStatus(
        state: LinkConnectionState.closed,
        closeCode: LinkCloseCode.revoked,
      ),
      machineName: 'Studio Mac',
      now: _now,
    );

    expect(view.label, 'Removed from this machine · pair again');
    expect(view.tone, LinkStatusTone.down);
  });

  group('the bridge process', () {
    LinkStatusView withBridge(BridgeStatusState state) => presentLinkStatus(
      status: const LinkStatus(
        state: LinkConnectionState.connected,
        route: LinkRoute.lan,
      ),
      machineName: 'Studio Mac',
      now: _now,
      bridge: BridgeLinkStatus(state: state, conn: 1),
    );

    test('an up bridge leaves the link status alone', () {
      final view = withBridge(BridgeStatusState.up);
      expect(view.label, 'Studio Mac · Local network');
      expect(view.tone, LinkStatusTone.ok);
    });

    test('a starting bridge says so, and is not an error', () {
      final view = withBridge(BridgeStatusState.starting);
      expect(view.label, "Studio Mac's bridge is starting…");
      expect(view.state, 'Bridge starting…');
      expect(view.tone, LinkStatusTone.pending);
    });

    test('a bridge that is down or crashed reads as a problem', () {
      final down = withBridge(BridgeStatusState.down);
      expect(down.label, "Studio Mac's bridge is down");
      expect(down.tone, LinkStatusTone.down);

      final crashed = withBridge(BridgeStatusState.crashed);
      expect(crashed.label, "Studio Mac's bridge crashed");
      expect(crashed.tone, LinkStatusTone.down);
      expect(crashed.icon, AppIcons.warning);
    });

    test('the machine-less label names the bridge', () {
      expect(
        bridgeStatusLabel(
          const BridgeLinkStatus(state: BridgeStatusState.crashed, conn: 1),
        ),
        'Bridge crashed',
      );
      expect(
        bridgeStatusLabel(
          const BridgeLinkStatus(state: BridgeStatusState.up, conn: 1),
        ),
        isNull,
      );
    });
  });

  group('formatLinkTime', () {
    String ago(Duration age) => formatLinkTime(_now.subtract(age), _now);

    test('reads an age at the granularity that matters', () {
      expect(ago(const Duration(seconds: 0)), 'just now');
      expect(ago(const Duration(seconds: 59)), 'just now');
      expect(ago(const Duration(minutes: 1)), '1m ago');
      expect(ago(const Duration(minutes: 59)), '59m ago');
      expect(ago(const Duration(hours: 1)), '1h ago');
      expect(ago(const Duration(hours: 23)), '23h ago');
      expect(ago(const Duration(hours: 26)), 'yesterday');
      expect(ago(const Duration(days: 3)), '3d ago');
      expect(ago(const Duration(days: 40)), '40d ago');
    });

    test('hours ago today stay in hours, not yesterday', () {
      final lateEvening = DateTime(2026, 3, 17, 1, 30);
      expect(
        formatLinkTime(
          lateEvening.subtract(const Duration(hours: 2)),
          lateEvening,
        ),
        '2h ago',
      );
    });

    test('a machine seen later than now is not older than just now', () {
      expect(
        formatLinkTime(_now.add(const Duration(minutes: 5)), _now),
        'just now',
      );
    });
  });
}
