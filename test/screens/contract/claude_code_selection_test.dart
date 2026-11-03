import 'dart:async';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/ai_backend/backend_option_card.dart';
import 'package:broski/screens/ai_backend_screen.dart';
import 'package:broski/screens/main_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/widget_rig.dart';
import '../../support/fake_websocket.dart';

const _selectedKey = 'broski_selected_agent_type';

SessionSummary _row(String id, String title, String cwd, int at) =>
    SessionSummary(
      session: SessionRef(backend: BackendId.claudeCode, sessionId: id),
      title: SessionTitle(text: title, source: TitleSource.user),
      cwd: cwd,
      updatedAt: at,
      archived: false,
      status: SessionStatus.idle,
      origin: SessionOrigin.broski,
    );

final _rows = [
  _row('c1', 'Fix the build', '/work/app', 2),
  _row('c2', 'Add a login', '/work/api', 1),
];

/// The old protocol's side: answers nothing useful, and keeps every frame
/// the app sent it, so a test can say none was a `cc_` request.
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

  Iterable<String> get ccTypes => sent
      .map((message) => '${message['type']}')
      .where((type) => type.startsWith('cc_'));
}

List<Override> _oldSide(FakeWebSocket socket) => [
  webSocketServiceProvider.overrideWithValue(socket),
  connectionProvider.overrideWith(
    (ref) => ConnectionNotifier(
      ref,
      ref.read(webSocketServiceProvider),
      ref.read(bridgeServiceProvider),
    ),
  ),
];

/// A bridge that serves Pi and, when [claudeCode], the contract Claude Code
/// (what `claudeCode.contract: true` makes the bridge list).
WidgetRig _rig({bool claudeCode = true}) {
  final rig = WidgetRig();
  rig.bridge
    ..on<BackendsListRequest>(
      (request) => BackendsListResponse(
        requestId: request.requestId,
        backends: [
          const BackendDescriptor(id: BackendId.pi, capabilities: everything),
          if (claudeCode)
            const BackendDescriptor(
              id: BackendId.claudeCode,
              capabilities: everything,
            ),
        ],
      ),
    )
    ..on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: SessionsListed(
          page: SessionPage(
            items: request.backend == BackendId.claudeCode ? _rows : const [],
          ),
        ),
      ),
    );
  return rig;
}

Future<(WidgetRig, _OldBridge)> _pump(
  WidgetTester tester,
  Widget home, {
  required String stored,
  bool claudeCode = true,
}) async {
  FlutterSecureStorage.setMockInitialValues({_selectedKey: stored});
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final socket = _OldBridge();
  addTearDown(socket.close);
  final rig = _rig(claudeCode: claudeCode);
  addTearDown(rig.dispose);
  await rig.pump(tester, home, overrides: _oldSide(socket));
  await tester.pumpAndSettle();
  return (rig, socket);
}

void main() {
  testWidgets('the picker offers the new Claude Code beside the old one, '
      'and the choice survives a restart', (tester) async {
    final (rig, socket) = await _pump(
      tester,
      const AIBackendScreen(),
      stored: 'claude-code',
    );
    expect(
      find.widgetWithText(BackendOptionCard, 'Claude Code'),
      findsOneWidget,
    );
    expect(
      find.widgetWithText(BackendOptionCard, 'Claude Code (new)'),
      findsOneWidget,
    );

    await tester.tap(find.byKey(const ValueKey('backend-option:claude-code')));
    await tester.pumpAndSettle();
    expect(
      await const FlutterSecureStorage().read(key: _selectedKey),
      'contract:claude-code',
    );

    final restarted = ProviderContainer(
      overrides: [
        ..._oldSide(socket),
        contractClientProvider.overrideWithValue(rig.client),
      ],
    );
    addTearDown(restarted.dispose);
    await tester.runAsync(
      () => restarted.read(selectedBackendProvider.notifier).ready,
    );
    expect(
      restarted.read(selectedBackendProvider),
      const ContractSelection(BackendId.claudeCode),
    );
  });

  testWidgets('choosing the old Claude Code again stores its own name', (
    tester,
  ) async {
    await _pump(
      tester,
      const AIBackendScreen(),
      stored: 'contract:claude-code',
    );
    await tester.tap(find.widgetWithText(BackendOptionCard, 'Claude Code'));
    await tester.pumpAndSettle();
    expect(
      await const FlutterSecureStorage().read(key: _selectedKey),
      'claude-code',
    );
  });

  testWidgets('a bridge that does not serve it offers only the old one', (
    tester,
  ) async {
    await _pump(
      tester,
      const AIBackendScreen(),
      stored: 'claude-code',
      claudeCode: false,
    );
    expect(
      find.byKey(const ValueKey('backend-option:claude-code')),
      findsNothing,
    );
    expect(find.text('Claude Code (new)'), findsNothing);
    expect(find.byKey(const ValueKey('backend-option:pi')), findsOneWidget);
  });

  testWidgets('with the new Claude Code chosen, Sessions and Projects come '
      'from the contract and no old request is sent', (tester) async {
    final (rig, socket) = await _pump(
      tester,
      const MainShell(),
      stored: 'contract:claude-code',
    );
    expect(find.text('Claude Code (new) sessions'), findsOneWidget);
    expect(find.byKey(const ValueKey('session-row:c1')), findsOneWidget);
    expect(rig.sent<SessionsListRequest>().backend, BackendId.claudeCode);

    await tester.tap(find.byKey(const ValueKey('session-row:c1')));
    await tester.pumpAndSettle();
    final chat = tester.widget<AgentChatScreen>(find.byType(AgentChatScreen));
    expect(chat.session.backend, BackendId.claudeCode);
    await tester.pageBack();
    await tester.pumpAndSettle();

    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    expect(find.text('app'), findsOneWidget);
    expect(find.text('api'), findsOneWidget);
    expect(socket.ccTypes, isEmpty);
  });

  testWidgets('an old selection stays the old Claude Code', (tester) async {
    final (_, _) = await _pump(
      tester,
      const MainShell(),
      stored: 'claude-code',
    );
    final container = ProviderScope.containerOf(
      tester.element(find.byType(MainShell)),
    );
    expect(
      container.read(selectedBackendProvider),
      const LegacySelection(AgentType.claudeCode),
    );
    expect(find.text('Claude Code (new) sessions'), findsNothing);
  });
}
