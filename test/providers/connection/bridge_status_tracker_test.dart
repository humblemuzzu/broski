import 'package:broski/providers/connection/bridge_status_tracker.dart';
import 'package:broski/providers/connection/link_status_mapping.dart';
import 'package:broski/services/bridge/bridge_reset_exception.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

/// The controller's two hooks, in the order it calls them: the link status is
/// published, then the tracker reads it.
final class Rig {
  final List<ConnectionStatus> published = [];
  final List<BridgeResetReason> reasons = [];
  var resyncs = 0;

  late final LinkStatusPublisher publisher = LinkStatusPublisher(
    publish: published.add,
    onConnected: () => resyncs++,
  );

  late final BridgeStatusTracker tracker = BridgeStatusTracker(
    publisher: publisher,
    onReset: reasons.add,
  );

  void link(LinkConnectionState state, {bool sessionReset = false}) {
    final status = LinkStatus(state: state, sessionReset: sessionReset);
    publisher.add(status);
    tracker.onLinkStatus(status);
  }

  void connect() {
    link(LinkConnectionState.connecting);
    link(LinkConnectionState.connected);
  }

  void bridge(BridgeStatusState state, int conn) =>
      tracker.onBridgeStatus(BridgeLinkStatus(state: state, conn: conn));
}

void main() {
  late Rig rig;

  setUp(() => rig = Rig());

  test(
    'a link connect resyncs once and the first bridge status adds nothing',
    () {
      rig.connect();
      expect(rig.published, [
        ConnectionStatus.connecting,
        ConnectionStatus.connected,
      ]);
      expect(rig.resyncs, 1);

      rig.bridge(BridgeStatusState.up, 1);

      expect(rig.resyncs, 1);
      expect(rig.published, hasLength(2));
      expect(rig.reasons, isEmpty);
    },
  );

  test('a new bridge socket resyncs exactly once', () {
    rig.connect();
    rig.bridge(BridgeStatusState.up, 1);
    rig.published.clear();

    rig.bridge(BridgeStatusState.up, 2);

    expect(rig.published, [
      ConnectionStatus.connecting,
      ConnectionStatus.connected,
    ]);
    expect(rig.resyncs, 2);
    expect(rig.reasons, [BridgeResetReason.bridgeRestarted]);
  });

  test('a repeat of the same bridge socket resyncs nothing', () {
    rig.connect();
    rig.bridge(BridgeStatusState.up, 3);
    rig.bridge(BridgeStatusState.up, 3);
    rig.published.clear();

    rig.bridge(BridgeStatusState.up, 3);

    expect(rig.published, isEmpty);
    expect(rig.resyncs, 1);
  });

  test('a bridge that is not up reports connecting, once per stretch', () {
    rig.connect();
    rig.bridge(BridgeStatusState.up, 1);
    rig.published.clear();

    rig.bridge(BridgeStatusState.crashed, 1);
    rig.bridge(BridgeStatusState.starting, 1);
    rig.bridge(BridgeStatusState.down, 1);

    expect(rig.published, [ConnectionStatus.connecting]);
    expect(rig.reasons, [
      BridgeResetReason.bridgeUnavailable,
      BridgeResetReason.bridgeUnavailable,
      BridgeResetReason.bridgeUnavailable,
    ]);
  });

  test('a bridge that comes back up resyncs once', () {
    rig.connect();
    rig.bridge(BridgeStatusState.up, 1);
    rig.bridge(BridgeStatusState.crashed, 1);
    rig.published.clear();

    rig.bridge(BridgeStatusState.up, 2);

    expect(rig.published, [
      ConnectionStatus.connecting,
      ConnectionStatus.connected,
    ]);
    expect(rig.resyncs, 2);
  });

  test(
    'a fresh session whose bridge is still starting resyncs nothing more',
    () {
      rig.connect();
      rig.published.clear();

      rig.bridge(BridgeStatusState.connecting, 0);
      expect(rig.published, isEmpty);
      expect(rig.resyncs, 1);

      rig.bridge(BridgeStatusState.up, 1);

      expect(rig.published, isEmpty, reason: 'the link edge already resynced');
      expect(rig.resyncs, 1);
      expect(rig.reasons, isEmpty);
    },
  );

  test('a fresh session that opens on a crashed bridge fails nothing', () {
    rig.connect();
    rig.published.clear();

    rig.bridge(BridgeStatusState.crashed, 0);
    rig.bridge(BridgeStatusState.starting, 0);
    rig.bridge(BridgeStatusState.up, 1);

    expect(rig.published, isEmpty);
    expect(rig.resyncs, 1, reason: 'one resync, from the link edge');
    expect(
      rig.reasons,
      isEmpty,
      reason: 'the daemon queues these requests until its socket is ready',
    );
  });

  test(
    'a replaced link session resyncs once, and its bridge status adds none',
    () {
      rig.connect();
      rig.bridge(BridgeStatusState.up, 1);
      rig.link(LinkConnectionState.connected, sessionReset: true);
      rig.published.clear();

      rig.bridge(BridgeStatusState.up, 2);

      expect(rig.reasons, contains(BridgeResetReason.linkSessionReset));
      expect(rig.published, isEmpty);
      expect(rig.resyncs, 2);
    },
  );

  test('a resumed link reconnect keeps the bridge socket quiet', () {
    rig.connect();
    rig.bridge(BridgeStatusState.up, 4);
    rig.link(LinkConnectionState.waiting);
    rig.link(LinkConnectionState.connected);
    rig.published.clear();

    rig.bridge(BridgeStatusState.up, 4);

    expect(rig.published, isEmpty);
    expect(rig.resyncs, 2, reason: 'the link reconnect itself resynced');
    expect(rig.reasons, isEmpty);
  });

  test('a closed link fails requests and forgets the bridge socket', () {
    rig.connect();
    rig.bridge(BridgeStatusState.up, 1);

    rig.link(LinkConnectionState.closed);

    expect(rig.reasons, [BridgeResetReason.linkClosed]);

    rig.connect();
    rig.bridge(BridgeStatusState.up, 1);

    expect(rig.reasons, [BridgeResetReason.linkClosed]);
  });

  test(
    'an unknown bridge state counts as not up until a known one arrives',
    () {
      rig.connect();
      rig.bridge(BridgeStatusState.up, 1);
      rig.published.clear();

      rig.bridge(BridgeStatusState.unknown, 1);

      expect(rig.published, [ConnectionStatus.connecting]);

      rig.bridge(BridgeStatusState.up, 1);

      expect(rig.published, [
        ConnectionStatus.connecting,
        ConnectionStatus.connecting,
        ConnectionStatus.connected,
      ]);
    },
  );
}
