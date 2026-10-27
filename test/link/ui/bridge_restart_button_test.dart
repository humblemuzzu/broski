import 'package:broski/providers/connection/link_control_provider.dart';
import 'package:broski/widgets/link/bridge_restart_button.dart';
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

  testWidgets('a crash reason is carried in the tooltip', (tester) async {
    await pumpLinkUi(
      tester,
      linkUiContainer(),
      BridgeRestartButton(send: (_) {}, detail: 'exit code 1'),
    );

    expect(find.byTooltip('Restart: exit code 1'), findsOneWidget);
  });
}
