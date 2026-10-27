import 'package:broski/providers/connection/bridge_status_provider.dart';
import 'package:broski/providers/link/link_status_provider.dart';
import 'package:broski/widgets/connection_indicator.dart';
import 'package:broski/widgets/link/bridge_restart_button.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/widgets/link/link_status_indicator.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_ui_support.dart';

Override seededStatus(String machineId, LinkStatus status) =>
    linkStatusSinkProvider.overrideWith(
      (ref) => LinkStatusSink()..publish(machineId, status),
    );

void main() {
  testWidgets('a connected machine names itself and its route', (tester) async {
    final machine = testMachine();
    final container = linkUiContainer(
      overrides: [
        seededStatus(
          machine.id,
          const LinkStatus(
            state: LinkConnectionState.connected,
            route: LinkRoute.lan,
          ),
        ),
      ],
    );
    await container.read(machinesProvider.notifier).add(machine);

    await pumpLinkUi(tester, container, const LinkStatusIndicator());

    expect(find.text('Studio Mac · Local network'), findsOneWidget);
  });

  testWidgets('a row that already names the machine drops the name', (
    tester,
  ) async {
    final machine = testMachine();
    final container = linkUiContainer(
      overrides: [
        seededStatus(
          machine.id,
          const LinkStatus(
            state: LinkConnectionState.connected,
            route: LinkRoute.relay,
          ),
        ),
      ],
    );
    await container.read(machinesProvider.notifier).add(machine);

    await pumpLinkUi(
      tester,
      container,
      const LinkStatusIndicator(showMachine: false),
    );

    expect(find.text('Remote'), findsOneWidget);
    expect(find.text('Studio Mac · Remote'), findsNothing);
  });

  testWidgets('an offline machine reports when it was last seen', (
    tester,
  ) async {
    final machine = testMachine();
    final container = linkUiContainer(
      overrides: [
        seededStatus(
          machine.id,
          LinkStatus(
            state: LinkConnectionState.machineOffline,
            lastSeen: DateTime.now().subtract(const Duration(minutes: 5)),
          ),
        ),
      ],
    );
    await container.read(machinesProvider.notifier).add(machine);

    await pumpLinkUi(tester, container, const LinkStatusIndicator());

    expect(
      find.text('Studio Mac is offline · last seen 5m ago'),
      findsOneWidget,
    );
  });

  testWidgets('a status for another machine is not this machine\'s status', (
    tester,
  ) async {
    final machine = testMachine();
    final container = linkUiContainer(
      overrides: [
        seededStatus(
          'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
          const LinkStatus(
            state: LinkConnectionState.connected,
            route: LinkRoute.lan,
          ),
        ),
      ],
    );
    await container.read(machinesProvider.notifier).add(machine);

    await pumpLinkUi(tester, container, const LinkStatusIndicator());

    expect(find.byType(Text), findsNothing);
  });

  testWidgets('a machine with no status yet shows no status', (tester) async {
    final machine = testMachine();
    final container = linkUiContainer();
    await container.read(machinesProvider.notifier).add(machine);

    await pumpLinkUi(tester, container, const LinkStatusIndicator());

    expect(find.byType(Text), findsNothing);
  });

  testWidgets('a crashed bridge on a sleeping machine shows the link, not it', (
    tester,
  ) async {
    final machine = testMachine();
    final container = linkUiContainer(
      overrides: [
        seededStatus(
          machine.id,
          const LinkStatus(state: LinkConnectionState.machineAsleep),
        ),
        bridgeLinkStatusProvider.overrideWith(
          (ref) => BridgeLinkStatusSink()
            ..publish(
              const BridgeLinkStatus(state: BridgeStatusState.crashed, conn: 3),
            ),
        ),
      ],
    );
    await container.read(machinesProvider.notifier).add(machine);

    await pumpLinkUi(
      tester,
      container,
      const Column(
        children: [
          LinkStatusIndicator(),
          ConnectionIndicator(
            status: ConnectionStatus.connected,
            agentAvailable: true,
          ),
        ],
      ),
    );

    expect(find.text('Studio Mac is asleep'), findsOneWidget);
    expect(find.byType(BridgeRestartButton), findsNothing);
  });

  testWidgets('a crashed bridge on a connected machine offers the restart', (
    tester,
  ) async {
    final machine = testMachine();
    final container = linkUiContainer(
      overrides: [
        seededStatus(
          machine.id,
          const LinkStatus(
            state: LinkConnectionState.connected,
            route: LinkRoute.lan,
          ),
        ),
        bridgeLinkStatusProvider.overrideWith(
          (ref) => BridgeLinkStatusSink()
            ..publish(
              const BridgeLinkStatus(
                state: BridgeStatusState.crashed,
                conn: 1,
                detail: 'exit code 1',
              ),
            ),
        ),
      ],
    );
    await container.read(machinesProvider.notifier).add(machine);

    await pumpLinkUi(tester, container, const LinkStatusIndicator());

    expect(find.text("Studio Mac's bridge crashed"), findsOneWidget);
    expect(find.byType(BridgeRestartButton), findsOneWidget);
    expect(find.text('Restart · exit code 1'), findsOneWidget);
  });
}
