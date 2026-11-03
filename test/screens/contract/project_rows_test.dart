import 'dart:async';

import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/main_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/op_sheet_rig.dart';
import '../../agent/support/widget_rig.dart';
import '../../support/fake_websocket.dart';

SessionSummary _row(String id, String cwd, int at) => SessionSummary(
  session: SessionRef(backend: BackendId.claudeCode, sessionId: id),
  title: SessionTitle(text: id, source: TitleSource.user),
  cwd: cwd,
  updatedAt: at,
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.broski,
);

final _rows = [_row('newest', '/work/app', 3), _row('older', '/work/app', 2)];

class _OldBridge extends FakeWebSocket {
  @override
  bool send(Map<String, dynamic> message) {
    final sent = super.send(message);
    if (message['requestId'] case final String id) {
      scheduleMicrotask(
        () => deliver({'type': 'error', 'requestId': id, 'message': 'no'}),
      );
    }
    return sent;
  }
}

final _configuration = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': ['config_files', 'settings_overview', 'plugins'],
});

/// The new Claude Code chosen, its sessions in `/work/app`; a list asked for
/// one directory answers [inDirectory], newest first.
Future<WidgetRig> _projects(
  WidgetTester tester, {
  List<SessionSummary>? inDirectory,
  Capabilities capabilities = everything,
}) async {
  FlutterSecureStorage.setMockInitialValues({
    'broski_selected_agent_type': 'contract:claude-code',
  });
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final socket = _OldBridge();
  addTearDown(socket.close);
  final rig = WidgetRig();
  addTearDown(rig.dispose);
  rig.bridge
    ..on<BackendsListRequest>(
      (request) => BackendsListResponse(
        requestId: request.requestId,
        backends: [
          BackendDescriptor(
            id: BackendId.claudeCode,
            capabilities: capabilities,
          ),
        ],
      ),
    )
    ..on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: SessionsListed(
          page: SessionPage(
            items: request.query.cwd == null ? _rows : (inDirectory ?? _rows),
          ),
        ),
      ),
    )
    ..on<BackendCallRequest>((_) => null);
  await rig.pump(
    tester,
    const MainShell(),
    overrides: [
      webSocketServiceProvider.overrideWithValue(socket),
      connectionProvider.overrideWith(
        (ref) => ConnectionNotifier(
          ref,
          ref.read(webSocketServiceProvider),
          ref.read(bridgeServiceProvider),
        ),
      ),
    ],
  );
  await tester.pumpAndSettle();
  await tester.tap(find.text('Projects'));
  await tester.pumpAndSettle();
  return rig;
}

void main() {
  testWidgets('a project row offers the backend\'s operations on its '
      'directory, run for that directory', (tester) async {
    final rig = await _projects(tester, capabilities: _configuration);
    await tester.longPress(find.text('app'));
    await tester.pumpAndSettle();
    await tapKey(tester, 'project-panels');
    expect(find.text('Configuration files'), findsOneWidget);
    expect(find.text('Settings in effect'), findsOneWidget);
    expect(find.text('Plugins'), findsOneWidget);

    await tapKey(tester, 'panel:settings_overview');
    expect(lastOp(rig), const SettingsOverviewOp(cwd: '/work/app'));
    expect(rig.sent<BackendCallRequest>().call, isA<ClaudeCodeCall>());
  });

  testWidgets('without configuration operations the row offers none', (
    tester,
  ) async {
    await _projects(tester);
    await tester.longPress(find.text('app'));
    await tester.pumpAndSettle();
    expect(byKey('project-panels'), findsNothing);
    expect(byKey('project-continue-latest'), findsOneWidget);
  });

  testWidgets('continue latest opens the newest session of the project', (
    tester,
  ) async {
    final rig = await _projects(tester);
    await tester.longPress(find.text('app'));
    await tester.pumpAndSettle();
    await tapKey(tester, 'project-continue-latest');

    final asked = rig.sent<SessionsListRequest>();
    expect(asked.query.cwd, '/work/app');
    expect(asked.page.limit, 1);
    final chat = tester.widget<AgentChatScreen>(find.byType(AgentChatScreen));
    expect(
      chat.session,
      const SessionRef(backend: BackendId.claudeCode, sessionId: 'newest'),
    );
  });

  testWidgets('continue latest says so when the project has no session', (
    tester,
  ) async {
    await _projects(tester, inDirectory: const []);
    await tester.longPress(find.text('app'));
    await tester.pumpAndSettle();
    await tapKey(tester, 'project-continue-latest');
    expect(find.byType(AgentChatScreen), findsNothing);
    expect(find.text('No session in app yet.'), findsOneWidget);
  });
}
