import 'package:broski/agent/ui/home/agent_home_screen.dart';
import 'package:broski/screens/settings/app_version_line.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/widget_rig.dart';

void main() {
  testWidgets('a long press on the version line opens the agent core', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    await rig.pump(tester, const Scaffold(body: AppVersionLine()));
    expect(find.textContaining('Broski v'), findsOneWidget);
    await tester.longPress(find.textContaining('Broski v'));
    await WidgetRig.settle(tester);
    expect(find.byType(AgentHomeScreen), findsOneWidget);
  });
}
