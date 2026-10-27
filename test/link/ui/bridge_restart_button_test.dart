import 'package:broski/providers/connection/link_control_provider.dart';
import 'package:broski/widgets/link/bridge_restart_button.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_ui_support.dart';

void main() {
  testWidgets('the restart control sends a bridge restart over the link', (
    tester,
  ) async {
    final sent = <Map<String, Object?>>[];
    await pumpLinkUi(
      tester,
      linkUiContainer(),
      BridgeRestartButton(send: sent.add),
    );

    await tester.tap(find.text('Restart'));

    expect(sent, [bridgeRestartControl]);
  });

  testWidgets('a crash reason is carried in the tooltip and the chip', (
    tester,
  ) async {
    await pumpLinkUi(
      tester,
      linkUiContainer(),
      BridgeRestartButton(send: (_) {}, detail: 'exit code 1'),
    );

    expect(find.byTooltip('Restart: exit code 1'), findsOneWidget);
    expect(find.text('Restart · exit code 1'), findsOneWidget);
  });

  testWidgets('a second tap during the restart is ignored', (tester) async {
    final sent = <Map<String, Object?>>[];
    await pumpLinkUi(
      tester,
      linkUiContainer(),
      BridgeRestartButton(send: sent.add),
    );

    await tester.tap(find.text('Restart'));
    await tester.pump();
    expect(find.text('Restarting…'), findsOneWidget);

    await tester.tap(find.text('Restarting…'));
    await tester.pump();

    expect(sent, [bridgeRestartControl]);

    await tester.pump(bridgeRestartCooldown);
    expect(find.text('Restart'), findsOneWidget);
  });

  testWidgets('the control is a labelled button with a 48 dp target', (
    tester,
  ) async {
    await pumpLinkUi(
      tester,
      linkUiContainer(),
      BridgeRestartButton(send: (_) {}),
    );

    expect(
      tester.getSemantics(find.byType(BridgeRestartButton)),
      containsSemantics(label: 'Restart the bridge', isButton: true),
    );
    final size = tester.getSize(
      find.descendant(
        of: find.byType(BridgeRestartButton),
        matching: find.byType(InkWell),
      ),
    );
    expect(size.height, greaterThanOrEqualTo(48));
    expect(size.width, greaterThanOrEqualTo(48));
  });
}
