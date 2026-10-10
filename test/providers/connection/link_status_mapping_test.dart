import 'package:broski/providers/connection/link_status_mapping.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('an idle link reads as connecting, not disconnected', () {
    for (final state in const [
      LinkConnectionState.connecting,
      LinkConnectionState.waiting,
      LinkConnectionState.machineOffline,
      LinkConnectionState.machineAsleep,
    ]) {
      expect(
        connectionStatusFor(state),
        ConnectionStatus.connecting,
        reason: '$state',
      );
    }
    expect(
      connectionStatusFor(LinkConnectionState.connected),
      ConnectionStatus.connected,
    );
    expect(
      connectionStatusFor(LinkConnectionState.closed),
      ConnectionStatus.disconnected,
    );
  });

  group('LinkStatusPublisher', () {
    late List<ConnectionStatus> published;
    late int connections;
    late LinkStatusPublisher publisher;

    setUp(() {
      published = <ConnectionStatus>[];
      connections = 0;
      publisher = LinkStatusPublisher(
        publish: published.add,
        onConnected: () => connections++,
      );
    });

    test('an ordinary connection connects once and announces once', () {
      publisher.add(const LinkStatus(state: LinkConnectionState.connected));

      expect(published, [ConnectionStatus.connected]);
      expect(connections, 1);
    });

    test('a fresh session resyncs the app on the connecting edge', () {
      publisher.add(const LinkStatus(state: LinkConnectionState.connecting));
      publisher.add(
        const LinkStatus(
          state: LinkConnectionState.connected,
          sessionReset: true,
        ),
      );

      expect(published, [
        ConnectionStatus.connecting,
        ConnectionStatus.connecting,
        ConnectionStatus.connected,
      ]);
      expect(connections, 1);
    });

    test('a used session is not republished as a resync', () {
      publisher.add(
        const LinkStatus(state: LinkConnectionState.connected, resumed: true),
      );

      expect(published, [ConnectionStatus.connected]);
      expect(connections, 1);
    });

    test('a machine that goes offline only reports connecting', () {
      publisher.add(
        const LinkStatus(state: LinkConnectionState.machineOffline),
      );

      expect(published, [ConnectionStatus.connecting]);
      expect(connections, 0);
    });

    test('a closed link reports disconnected', () {
      publisher.add(const LinkStatus(state: LinkConnectionState.closed));

      expect(published, [ConnectionStatus.disconnected]);
      expect(connections, 0);
    });
  });
}
