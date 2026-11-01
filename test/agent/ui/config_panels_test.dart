import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

const _session = SessionRef(backend: BackendId.claudeCode, sessionId: 's1');

final _offered = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': ['config_files', 'settings_overview', 'mcp_servers', 'tasks'],
});

const _file = EditableFile(
  id: 'project-settings',
  path: '/work/.claude/settings.json',
  scope: 'project',
  format: EditableFileFormat.json,
  exists: true,
  text: '{}',
  revision: 'r1',
  editable: true,
  truncated: false,
  problems: [],
);

const _servers = ActionList(
  rows: [
    ActionListRow(
      id: 'github',
      title: 'github',
      status: ActionListStatus(label: 'connected', tone: ActionListTone.ok),
      group: 'Project',
      badges: ['project'],
      actions: [
        ActionListAction(id: 'disable', label: 'Disable', destructive: false),
      ],
    ),
  ],
  omitted: 0,
);

BackendCallResponse _answer(BackendCallRequest request, BackendOpResult r) =>
    BackendCallResponse(
      requestId: request.requestId,
      result: BackendCallAccepted(result: r),
    );

Future<WidgetRig> _chat(WidgetTester tester) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(capabilities: _offered);
  rig.bridge
    ..on<BackendsListRequest>(
      (request) => BackendsListResponse(
        requestId: request.requestId,
        backends: [
          BackendDescriptor(id: _session.backend, capabilities: _offered),
        ],
      ),
    )
    ..on<SessionGetRequest>(
      (request) => SessionGetResponse(
        requestId: request.requestId,
        result: const SessionFound(
          summary: SessionSummary(
            session: _session,
            updatedAt: 1,
            archived: false,
            status: SessionStatus.idle,
            origin: SessionOrigin.broski,
            cwd: '/work',
          ),
        ),
      ),
    );
  addTearDown(rig.dispose);
  await rig.pump(tester, const AgentChatScreen(session: _session));
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

Future<void> _tap(WidgetTester tester, Finder target) async {
  await tester.tap(target);
  await tester.pumpAndSettle();
}

ClaudeCodeOp _opOf(WidgetRig rig) =>
    (rig.sent<BackendCallRequest>().call as ClaudeCodeCall).op;

void main() {
  test('a kind two backends serve is carried to the session\'s backend', () {
    const op = SessionSettingsOp(sessionId: 's1');
    expect(opCall(_session, op), const ClaudeCodeCall(op: op));
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

  testWidgets('a configuration file is listed for the session\'s directory, '
      'opened, and saved at the revision read', (tester) async {
    final rig = await _chat(tester);
    rig.bridge.on<BackendCallRequest>(
      (request) => switch (request.call) {
        ClaudeCodeCall(op: ConfigFileOp()) => _answer(
          request,
          const ConfigFileRead(file: _file),
        ),
        _ => _answer(
          request,
          const ConfigFilesListed(
            files: [
              ConfigFileEntry(
                id: 'project-settings',
                label: 'Project settings',
                group: 'settings',
                scope: 'project',
                path: '/work/.claude/settings.json',
                exists: true,
                editable: true,
                format: EditableFileFormat.json,
                template: false,
              ),
            ],
            omitted: 0,
          ),
        ),
      },
    );
    await _tap(tester, _key('chat-panels'));
    await _tap(tester, _key('panel:config_files'));
    expect(_opOf(rig), const ConfigFilesOp(cwd: '/work'));

    await _tap(tester, _key('config-file:project-settings'));
    expect(
      _opOf(rig),
      const ConfigFileOp(cwd: '/work', fileId: 'project-settings'),
    );

    await tester.enterText(_key('editable-file-text'), '{"a": 1}');
    await _tap(tester, _key('editable-file-save'));
    expect(
      _opOf(rig),
      const ConfigFileOp(
        cwd: '/work',
        fileId: 'project-settings',
        change: EditableFileWrite(text: '{"a": 1}', revision: 'r1'),
      ),
    );
  });

  testWidgets('a list shows each row with its state and takes an action on '
      'it', (tester) async {
    final rig = await _chat(tester);
    rig.bridge.on<BackendCallRequest>(
      (request) => _answer(request, const McpServersListed(list: _servers)),
    );
    await _tap(tester, _key('chat-panels'));
    await _tap(tester, _key('panel:mcp_servers'));
    expect(find.text('connected'), findsOneWidget);
    expect(find.text('Project'), findsOneWidget);

    await _tap(tester, _key('row-action:github:disable'));
    expect(
      _opOf(rig),
      const McpServersOp(
        sessionId: 's1',
        change: ActionListChange(rowId: 'github', actionId: 'disable'),
      ),
    );
  });
}
