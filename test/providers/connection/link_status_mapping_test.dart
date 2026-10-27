import 'package:broski/providers/connection/link_status_mapping.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('an attempt in progress reads as connecting', () {
    for (final state in const [
      LinkConnectionState.connecting,
      LinkConnectionState.waiting,
    ]) {
      expect(
        connectionStatusFor(state),
        ConnectionStatus.connecting,
        reason: '$state',
      );
    }
  });

  test('a machine that is asleep or offline reads as disconnected', () {
    // The chip beside the machine has always said "Offline"; a status of
    // connecting made the rest of the app say "Reconnecting" for ever.
    for (final state in const [
      LinkConnectionState.machineOffline,
      LinkConnectionState.machineAsleep,
      LinkConnectionState.closed,
    ]) {
      expect(
        connectionStatusFor(state),
        ConnectionStatus.disconnected,
        reason: '$state',
      );
    }
    expect(
      connectionStatusFor(LinkConnectionState.connected),
      ConnectionStatus.connected,
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

    test('a second connected status announces nothing', () {
      publisher.add(const LinkStatus(state: LinkConnectionState.connected));
      publisher.add(const LinkStatus(state: LinkConnectionState.connected));
      publisher.add(
        const LinkStatus(
          state: LinkConnectionState.connected,
          route: LinkRoute.relay,
        ),
      );

      expect(published, [ConnectionStatus.connected]);
      expect(connections, 1);
    });

    test('a reconnect after a drop is a new edge', () {
      publisher.add(const LinkStatus(state: LinkConnectionState.connected));
      publisher.add(const LinkStatus(state: LinkConnectionState.waiting));
      publisher.add(const LinkStatus(state: LinkConnectionState.connected));

      expect(published, [
        ConnectionStatus.connected,
        ConnectionStatus.connecting,
        ConnectionStatus.connected,
      ]);
      expect(connections, 2);
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

    test(
      'a reset while connected still announces, because the view is gone',
      () {
        publisher.add(const LinkStatus(state: LinkConnectionState.connected));
        publisher.add(
          const LinkStatus(
            state: LinkConnectionState.connected,
            sessionReset: true,
          ),
        );

        expect(published, [
          ConnectionStatus.connected,
          ConnectionStatus.connecting,
          ConnectionStatus.connected,
        ]);
        expect(connections, 2);
      },
    );

    test('a used session is not republished as a resync', () {
      publisher.add(
        const LinkStatus(state: LinkConnectionState.connected, resumed: true),
      );

      expect(published, [ConnectionStatus.connected]);
      expect(connections, 1);
    });

    test('a machine that goes offline reports disconnected', () {
      publisher.add(const LinkStatus(state: LinkConnectionState.connected));
      publisher.add(
        const LinkStatus(state: LinkConnectionState.machineOffline),
      );

      expect(published, [
        ConnectionStatus.connected,
        ConnectionStatus.disconnected,
      ]);
      expect(connections, 1);
    });

    test('a closed link reports disconnected', () {
      publisher.add(const LinkStatus(state: LinkConnectionState.closed));

      expect(published, [ConnectionStatus.disconnected]);
      expect(connections, 0);
    });

    test('a reset publisher treats the next connected status as an edge', () {
      publisher.add(const LinkStatus(state: LinkConnectionState.connected));
      publisher.reset();
      publisher.add(const LinkStatus(state: LinkConnectionState.connected));

      expect(published, [
        ConnectionStatus.connected,
        ConnectionStatus.connected,
      ]);
      expect(connections, 2);
    });
  });
}
