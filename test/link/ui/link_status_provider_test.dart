import 'package:broski/providers/link/link_status_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_ui_support.dart';

const _connected = LinkStatus(
  state: LinkConnectionState.connected,
  route: LinkRoute.lan,
);

void main() {
  test(
    'the selected machine hands out the status that was published for it',
    () async {
      final machine = testMachine();
      final container = linkUiContainer();
      await container.read(machinesProvider.notifier).add(machine);

      container
          .read(linkStatusSinkProvider.notifier)
          .publish(machine.id, _connected);

      expect(container.read(linkStatusProvider), _connected);
    },
  );

  test(
    'a status for a machine that is not selected reads as no status',
    () async {
      final machine = testMachine();
      final other = testMachine(id: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2');
      final container = linkUiContainer();
      await container.read(machinesProvider.notifier).add(machine);
      await container.read(machinesProvider.notifier).add(other);

      container
          .read(linkStatusSinkProvider.notifier)
          .publish('c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', _connected);

      expect(container.read(linkStatusProvider), isNull);
    },
  );

  test('a link that goes away takes its status with it', () async {
    final machine = testMachine();
    final container = linkUiContainer();
    await container.read(machinesProvider.notifier).add(machine);
    final sink = container.read(linkStatusSinkProvider.notifier);
    sink.publish(machine.id, _connected);

    sink.clear();

    expect(container.read(linkStatusProvider), isNull);
  });

  test('no machine means no link status', () async {
    final container = linkUiContainer();
    await container.read(machinesProvider.notifier).add(testMachine());
    container
        .read(linkStatusSinkProvider.notifier)
        .publish(testMachine().id, _connected);

    await container.read(machinesProvider.notifier).select(null);

    expect(container.read(linkStatusProvider), isNull);
  });
}
