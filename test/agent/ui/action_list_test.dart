import 'package:broski/agent/ui/sessions/session_list_actions.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/op_sheet_rig.dart';
import '../support/widget_rig.dart';

ActionListRow _row(
  String id, {
  String? group,
  ActionListStatus? status,
  List<String> badges = const [],
  List<ActionListAction> actions = const [],
  String? subtitle,
}) => ActionListRow(
  id: id,
  title: id,
  subtitle: subtitle,
  status: status,
  group: group,
  badges: badges,
  actions: actions,
);

const _disable = ActionListAction(
  id: 'disable',
  label: 'Disable',
  destructive: false,
);
const _remove = ActionListAction(
  id: 'remove',
  label: 'Remove',
  destructive: true,
);

ActionListStatus _status(String label, ActionListTone tone) =>
    ActionListStatus(label: label, tone: tone);

Future<WidgetRig> _openServers(
  WidgetTester tester,
  BackendCallResponse Function(BackendCallRequest request) answer,
) async {
  final rig = await openChat(tester, ['mcp_servers']);
  rig.bridge.on<BackendCallRequest>(answer);
  await openPanel(tester, 'mcp_servers');
  return rig;
}

Color _textColor(WidgetTester tester, String text) =>
    tester.widget<Text>(find.text(text)).style!.color!;

void main() {
  testWidgets('rows sit under their group, in the colour of their tone, '
      'with badges', (tester) async {
    await _openServers(
      tester,
      (r) => answered(
        r,
        McpServersListed(
          list: ActionList(
            rows: [
              _row(
                'github',
                group: 'Project',
                status: _status('connected', ActionListTone.ok),
                badges: ['project', 'managed'],
              ),
              _row(
                'broken',
                group: 'User',
                status: _status('failed', ActionListTone.error),
                subtitle: 'spawn ENOENT',
              ),
              _row(
                'docs',
                group: 'Project',
                status: _status('starting', ActionListTone.busy),
              ),
              _row('later', status: _status('off', ActionListTone.neutral)),
            ],
            omitted: 0,
          ),
        ),
      ),
    );
    final theme = opencodeDarkTheme;
    expect(byKey('action-group:Project'), findsOneWidget);
    expect(byKey('action-group:User'), findsOneWidget);
    expect(
      tester.getTopLeft(byKey('action-row:docs')).dy,
      lessThan(tester.getTopLeft(byKey('action-group:User')).dy),
      reason: 'a row joins the section of its group, whatever its position',
    );
    expect(_textColor(tester, 'connected'), theme.success);
    expect(_textColor(tester, 'failed'), theme.error);
    expect(_textColor(tester, 'starting'), theme.info);
    expect(_textColor(tester, 'off'), theme.textMuted);
    expect(find.text('managed'), findsOneWidget);
    expect(find.text('spawn ENOENT'), findsOneWidget);
  });

  testWidgets('a destructive action is confirmed first; a plain one is not', (
    tester,
  ) async {
    final rig = await _openServers(
      tester,
      (r) => answered(
        r,
        McpServersListed(
          list: ActionList(
            rows: [
              _row('github', actions: [_disable, _remove]),
            ],
            omitted: 0,
          ),
        ),
      ),
    );
    await tapKey(tester, 'row-action:github:disable');
    expect(
      lastOp(rig),
      const McpServersOp(
        sessionId: 's1',
        change: ActionListChange(rowId: 'github', actionId: 'disable'),
      ),
    );

    final before = allOps(rig).length;
    await tapKey(tester, 'row-action:github:remove');
    expect(find.text('This cannot be undone.'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(allOps(rig).length, before, reason: 'cancelled: nothing is sent');

    await tapKey(tester, 'row-action:github:remove');
    await tester.tap(find.text('Remove').last);
    await tester.pumpAndSettle();
    expect(
      lastOp(rig),
      const McpServersOp(
        sessionId: 's1',
        change: ActionListChange(rowId: 'github', actionId: 'remove'),
      ),
    );
  });

  testWidgets('a note and what was left out are told as they are', (
    tester,
  ) async {
    await _openServers(
      tester,
      (r) => answered(
        r,
        McpServersListed(
          list: ActionList(
            rows: [_row('github')],
            omitted: 7,
            note: 'tests passed: 3',
          ),
        ),
      ),
    );
    expect(find.text('tests passed: 3'), findsOneWidget);
    expect(
      find.text('7 more are not shown: the list is at its limit.'),
      findsOneWidget,
    );
  });

  testWidgets('an empty list says so, with the reason the note gives', (
    tester,
  ) async {
    await _openServers(
      tester,
      (r) => answered(
        r,
        const McpServersListed(
          list: ActionList(rows: [], omitted: 0, note: 'No servers set up.'),
        ),
      ),
    );
    expect(find.text('Nothing to show.'), findsOneWidget);
    expect(find.text('No servers set up.'), findsOneWidget);
  });

  testWidgets('while an action is on its way the list waits, and a refusal '
      'leaves the rows as they were', (tester) async {
    const listed = McpServersListed(
      list: ActionList(
        rows: [
          ActionListRow(
            id: 'github',
            title: 'github',
            badges: [],
            actions: [_disable],
          ),
        ],
        omitted: 0,
      ),
    );
    final rig = await _openServers(tester, (r) => answered(r, listed));
    rig.bridge.on<BackendCallRequest>((r) {
      final op = (r.call as ClaudeCodeCall).op;
      return op is McpServersOp && op.change != null
          ? null
          : answered(r, listed);
    });
    await tester.tap(byKey('row-action:github:disable'));
    await tester.pump();
    expect(byKey('action-list-busy'), findsOneWidget);
    expect(
      tester.widget<TextButton>(byKey('row-action:github:disable')).onPressed,
      isNull,
    );

    rig.bridge.answer(
      refused(
        rig.bridge.waiting<BackendCallRequest>(),
        RejectionCode.notFound,
        'github is gone',
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('github is gone'), findsOneWidget);
    expect(byKey('action-row:github'), findsOneWidget);
    expect(byKey('action-list-busy'), findsNothing);
  });

  testWidgets('Refresh reads the list again', (tester) async {
    var served = 0;
    final rig = await _openServers(tester, (r) {
      served++;
      return answered(
        r,
        McpServersListed(
          list: ActionList(rows: [_row('server-$served')], omitted: 0),
        ),
      );
    });
    expect(byKey('action-row:server-1'), findsOneWidget);
    await tapKey(tester, 'action-list-refresh');
    expect(byKey('action-row:server-2'), findsOneWidget);
    expect(lastOp(rig), const McpServersOp(sessionId: 's1'));
  });

  testWidgets('a list the backend only reports offers no action', (
    tester,
  ) async {
    final rig = await openChat(tester, ['context_usage']);
    rig.bridge.on<BackendCallRequest>(
      (r) => answered(
        r,
        ContextUsageRead(
          list: ActionList(
            rows: [
              _row(
                'messages',
                actions: [_disable],
                status: _status('41%', ActionListTone.warning),
              ),
            ],
            omitted: 0,
          ),
        ),
      ),
    );
    await openPanel(tester, 'context_usage');
    expect(find.text('41%'), findsOneWidget);
    expect(byKey('row-action:messages:disable'), findsNothing);
  });

  testWidgets('custom tools: a row opens its definition, New tool the '
      'template, a test prints its output', (tester) async {
    final capabilities = offering(['custom_tools', 'custom_tool']);
    final rig = WidgetRig(capabilities: capabilities);
    addTearDown(rig.dispose);
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    var note = 'not run yet';
    EditableFile definition({
      String id = 'weather',
      String text = '{"name":"weather"}',
      String revision = 't1',
      bool exists = true,
    }) => EditableFile(
      id: id,
      path: 'tools/$id.json',
      scope: 'bridge',
      format: EditableFileFormat.json,
      exists: exists,
      text: text,
      revision: revision,
      editable: true,
      truncated: false,
      problems: const [],
    );
    rig.bridge.on<BackendCallRequest>((r) {
      final op = (r.call as ClaudeCodeCall).op;
      if (op is CustomToolOp) {
        return answered(
          r,
          CustomToolRead(
            file: op.toolId == null
                ? definition(id: 'tool-new', exists: false, revision: 'n')
                : definition(),
          ),
        );
      }
      if (op is CustomToolsOp && op.change != null) note = 'tested: 200 OK';
      return answered(
        r,
        CustomToolsListed(
          list: ActionList(
            rows: [
              _row(
                'weather',
                actions: const [
                  ActionListAction(
                    id: 'test',
                    label: 'Test',
                    destructive: false,
                  ),
                  ActionListAction(
                    id: 'delete',
                    label: 'Delete',
                    destructive: true,
                  ),
                ],
              ),
            ],
            omitted: 0,
            note: note,
          ),
        ),
      );
    });
    await rig.pump(
      tester,
      Scaffold(
        body: SessionListActions(
          backend: BackendDescriptor(
            id: BackendId.claudeCode,
            capabilities: capabilities,
          ),
          archived: false,
          onArchivedChanged: (_) {},
        ),
      ),
    );
    await tapKey(tester, 'backend-panels');
    await tapKey(tester, 'panel:custom_tools');
    expect(byKey('panel:custom_tool'), findsNothing);

    await tapKey(tester, 'row-action:weather:test');
    expect(
      lastOp(rig),
      const CustomToolsOp(
        change: ActionListChange(rowId: 'weather', actionId: 'test'),
      ),
    );
    expect(find.text('tested: 200 OK'), findsOneWidget);

    await tapKey(tester, 'open-row:weather');
    expect(lastOp(rig), const CustomToolOp(toolId: 'weather'));
    await tester.enterText(byKey('editable-file-text'), '{"name":"w2"}');
    await tapKey(tester, 'editable-file-save');
    expect(
      lastOp(rig),
      const CustomToolOp(
        toolId: 'weather',
        change: EditableFileWrite(text: '{"name":"w2"}', revision: 't1'),
      ),
    );

    await tapKey(tester, 'file-back');
    await tapKey(tester, 'custom-tool-new');
    expect(lastOp(rig), const CustomToolOp());
    expect(find.text('new file'), findsOneWidget);
    await tapKey(tester, 'editable-file-save');
    expect(
      (lastOp(rig) as CustomToolOp).change,
      isA<EditableFileWrite>().having((w) => w.revision, 'revision', 'n'),
    );
  });
}
