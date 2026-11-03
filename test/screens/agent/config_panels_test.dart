import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/op_result_host.dart';
import 'package:broski/screens/agent/panels/panel_registry.dart';
import 'package:broski/screens/agent/panels/result_actions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/op_sheet_rig.dart';
import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';

final _offered = offering([
  'config_files',
  'settings_overview',
  'mcp_servers',
  'tasks',
  'custom_tools',
  'custom_tool',
]);

void main() {
  test('a kind two backends serve is carried to the session\'s backend', () {
    const op = SessionSettingsOp(sessionId: 's1');
    expect(opCall(opSession, op), const ClaudeCodeCall(op: op));
    expect(opCall(sessionRef, op), const PiCall(op: op));
  });

  test('project panels are offered apart from the session\'s own', () {
    expect(
      [for (final p in panelsAt(_offered, OpPlace.project)) p.kind],
      [BackendOpKind.configFiles, BackendOpKind.settingsOverview],
    );
    expect(
      [
        for (final p in panelsAt(_offered, OpPlace.session, controllable: true))
          p.kind,
      ],
      [BackendOpKind.mcpServers, BackendOpKind.tasks],
    );
  });

  test('the custom tool editor is opened from the tool list, not offered '
      'apart from it', () {
    expect(
      [for (final p in panelsAt(_offered, OpPlace.backend)) p.kind],
      [BackendOpKind.customTools],
    );
  });

  testWidgets('an operation the session\'s backend has no such kind for is '
      'refused on the phone, not left waiting', (tester) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    ResultActions? held;
    await rig.pump(
      tester,
      Scaffold(
        body: OpResultHost(
          client: rig.client,
          target: sessionTarget(sessionRef),
          first: const ConfigFilesListed(files: [], omitted: 0),
          builder: (result, actions) {
            held = actions;
            return const SizedBox.shrink();
          },
        ),
      ),
    );
    final outcome = await held!.attempt(
      (target) => opCall(target.session, const CustomToolOp()),
    );
    await tester.pump();
    expect(
      outcome,
      isA<Refused<BackendOpResult>>().having(
        (refused) => refused.rejection.code,
        'code',
        RejectionCode.unsupported,
      ),
    );
    expect(held!.busy, isFalse);
    expect(rig.link.sent.whereType<BackendCallRequest>(), isEmpty);
  });

  testWidgets('configuration files are asked for the session\'s directory', (
    tester,
  ) async {
    final rig = await openChat(tester, ['config_files']);
    rig.bridge.on<BackendCallRequest>(
      (request) =>
          answered(request, const ConfigFilesListed(files: [], omitted: 0)),
    );
    await openPanel(tester, 'config_files');
    expect(lastOp(rig), const ConfigFilesOp(cwd: '/work'));
    expect(find.text('No files to show.'), findsOneWidget);
  });
}
