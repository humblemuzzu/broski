import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/screens/sheets/machines_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_ui_support.dart';

/// The machine-facing side of the link controller, with no socket behind it.
class _FakeLinkController
    with WidgetsBindingObserver
    implements LinkConnectionController {
  final switched = <Machine>[];
  final controls = <Map<String, Object?>>[];

  @override
  Future<void> switchTo(Machine machine) async => switched.add(machine);

  @override
  Stream<LinkSendFailure> get sendFailures =>
      const Stream<LinkSendFailure>.empty();

  @override
  void sendControl(Map<String, Object?> message) => controls.add(message);

  @override
  void beginPairing() {}

  @override
  void endPairing() {}

  @override
  Future<void> adopt(
    LinkConnection connection,
    Machine machine, {
    required bool connected,
  }) async {}

  @override
  void dispose() {}
}

void main() {
  testWidgets('lists the paired machines and marks the one in use', (
    tester,
  ) async {
    final studio = testMachine(
      lastConnectedAt: DateTime.now().subtract(const Duration(minutes: 2)),
    );
    final mini = testMachine(
      id: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
      name: 'Mac Mini',
      os: 'macOS 26',
    );
    final container = linkUiContainer();
    await container.read(machinesProvider.notifier).add(studio);
    await container.read(machinesProvider.notifier).add(mini);

    await pumpLinkUi(tester, container, const MachinesSheet());

    expect(find.text('Studio Mac'), findsOneWidget);
    expect(find.text('Mac Mini'), findsOneWidget);
    expect(find.byIcon(AppIcons.radioChecked), findsOneWidget);
    expect(find.text('Last connected 2m ago'), findsOneWidget);
    expect(find.text('Not connected yet'), findsOneWidget);
  });

  testWidgets('tapping another machine selects it and moves the link', (
    tester,
  ) async {
    final studio = testMachine();
    final mini = testMachine(
      id: 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2',
      name: 'Mac Mini',
    );
    final link = _FakeLinkController();
    final container = linkUiContainer(
      overrides: [linkConnectionControllerProvider.overrideWith((ref) => link)],
    );
    await container.read(machinesProvider.notifier).add(studio);
    await container.read(machinesProvider.notifier).add(mini);

    await pumpLinkUi(tester, container, const MachinesSheet());
    await tester.tap(find.text('Mac Mini'));
    await tester.pumpAndSettle();

    expect(container.read(machinesProvider).selectedId, mini.id);
    expect(link.switched.single.id, mini.id);
  });

  testWidgets('forgetting asks first, and keeps the machine when refused', (
    tester,
  ) async {
    final container = linkUiContainer();
    await container.read(machinesProvider.notifier).add(testMachine());

    await pumpLinkUi(tester, container, const MachinesSheet());
    await tester.tap(find.byIcon(AppIcons.moreVertical));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Forget this machine'));
    await tester.pumpAndSettle();

    expect(find.textContaining('broski-link revoke'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();

    expect(container.read(machinesProvider).machines, hasLength(1));
    expect(find.text('Studio Mac'), findsOneWidget);
  });

  testWidgets('forgetting confirmed drops the machine', (tester) async {
    final container = linkUiContainer();
    await container.read(machinesProvider.notifier).add(testMachine());

    await pumpLinkUi(tester, container, const MachinesSheet());
    await tester.tap(find.byIcon(AppIcons.moreVertical));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Forget this machine'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Forget'));
    await tester.pumpAndSettle();

    expect(container.read(machinesProvider).machines, isEmpty);
    expect(find.text('No machines paired yet.'), findsOneWidget);
  });
}
