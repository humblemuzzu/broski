import 'dart:async';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/cache/cached_kinds.dart';
import 'package:broski/agent/catalog/directory_summary.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/ai_backend_screen.dart';
import 'package:broski/screens/main_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/memory_text_store.dart';
import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';
import '../../support/fake_websocket.dart';

const _selectedKey = 'broski_selected_agent_type';

SessionSummary _row(String id, String title, String cwd, int at) =>
    SessionSummary(
      session: SessionRef(backend: BackendId.pi, sessionId: id),
      title: SessionTitle(text: title, source: TitleSource.user),
      cwd: cwd,
      updatedAt: at,
      archived: false,
      status: SessionStatus.idle,
      origin: SessionOrigin.broski,
    );

/// The old protocol's bridge, which these tests do not talk to: it answers
/// what the old tabs ask for with nothing, or a refusal, while the contract
/// is what is under test.
class _OldBridge extends FakeWebSocket {
  @override
  bool send(Map<String, dynamic> message) {
    final sent = super.send(message);
    if (message['requestId'] case final String id) {
      final reply = message['type'] == 'browse'
          ? {
              'type': 'browse_result',
              'requestId': id,
              'data': <String, Object?>{},
            }
          : {'type': 'error', 'requestId': id, 'message': 'no'};
      scheduleMicrotask(() => deliver(reply));
    }
    return sent;
  }
}

final _rows = [
  _row('s1', 'Fix the build', '/work/app', 2),
  _row('s2', 'Add a login', '/work/api', 1),
];

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

WidgetRig _rig({
  AgentCache? cache,
  bool reachable = true,
  Capabilities capabilities = everything,
}) {
  final rig = WidgetRig(
    cache: cache,
    reachable: reachable,
    capabilities: capabilities,
  );
  rig.bridge
    ..on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: SessionsListed(page: SessionPage(items: _rows)),
      ),
    )
    ..on<ModelsListRequest>(
      (request) => ModelsListResponse(
        requestId: request.requestId,
        result: const ModelsListed(models: []),
      ),
    )
    ..on<ModesListRequest>(
      (request) => ModesListResponse(
        requestId: request.requestId,
        result: const ModesListed(modes: []),
      ),
    )
    ..on<SessionCreateRequest>(
      (request) => SessionCreateResponse(
        requestId: request.requestId,
        result: const NewSessionAccepted(session: sessionRef),
      ),
    );
  return rig;
}

Future<WidgetRig> _shell(
  WidgetTester tester, {
  AgentCache? cache,
  bool reachable = true,
  Capabilities capabilities = everything,
}) async {
  FlutterSecureStorage.setMockInitialValues({_selectedKey: 'pi'});
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final socket = _OldBridge();
  addTearDown(socket.close);
  final rig = _rig(
    cache: cache,
    reachable: reachable,
    capabilities: capabilities,
  );
  addTearDown(rig.dispose);
  await rig.pump(tester, const MainShell(), overrides: _oldSide(socket));
  await tester.pumpAndSettle();
  return rig;
}

void main() {
  testWidgets(
    'the Sessions tab offers the backend-wide panels, such as import',
    (tester) async {
      await _shell(
        tester,
        capabilities: Capabilities.fromJson({
          ...everything.toJson(),
          'backendOps': ['import_session'],
        }),
      );
      await tester.tap(find.byKey(const ValueKey('backend-panels')));
      await tester.pumpAndSettle();
      expect(find.text('Import session file'), findsOneWidget);
    },
  );

  testWidgets('the Sessions tab has no More button when nothing is offered', (
    tester,
  ) async {
    await _shell(tester);
    expect(find.byKey(const ValueKey('backend-panels')), findsNothing);
  });

  testWidgets(
    'with Pi selected the Sessions tab lists its sessions and one opens',
    (tester) async {
      await _shell(tester);
      expect(find.byKey(const ValueKey('session-row:s1')), findsOneWidget);
      expect(find.byKey(const ValueKey('session-row:s2')), findsOneWidget);
      expect(find.text('Fix the build'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('session-row:s1')));
      await tester.pumpAndSettle();
      expect(find.byType(AgentChatScreen), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(AgentChatScreen), findsNothing);
      expect(find.byKey(const ValueKey('session-row:s1')), findsOneWidget);
    },
  );

  testWidgets(
    'Projects lists the directories of Pi and one starts a session there',
    (tester) async {
      final rig = await _shell(tester);
      await tester.tap(find.text('Projects'));
      await tester.pumpAndSettle();
      expect(find.text('app'), findsOneWidget);
      expect(find.text('api'), findsOneWidget);

      await tester.tap(find.text('app'));
      await tester.pumpAndSettle();
      expect(find.text('New session'), findsOneWidget);
      expect(
        tester
            .widget<TextField>(find.byKey(const ValueKey('new-session-cwd')))
            .controller!
            .text,
        '/work/app',
      );
      await tester.tap(find.text('Start'));
      await tester.pumpAndSettle();
      expect(rig.sent<SessionCreateRequest>().backend, BackendId.pi);
      expect(rig.sent<SessionCreateRequest>().options.cwd, '/work/app');
      expect(find.byType(AgentChatScreen), findsOneWidget);
    },
  );

  testWidgets('with the link down, Sessions and Projects show what was saved', (
    tester,
  ) async {
    final cache = AgentCache(MemoryTextStore());
    await cache.saveBackends([
      const BackendDescriptor(id: BackendId.pi, capabilities: everything),
    ]);
    await cache.saveSessions(
      BackendId.pi,
      const SessionQuery(archived: false),
      _rows,
    );
    await cache.saveDirectories(BackendId.pi, directoriesOf(_rows));

    final offline = await _shell(tester, cache: cache, reachable: false);
    expect(find.byKey(const ValueKey('session-row:s1')), findsOneWidget);
    expect(find.byKey(const ValueKey('offline-banner')), findsOneWidget);
    await tester.tap(find.text('Projects'));
    await tester.pumpAndSettle();
    expect(find.text('app'), findsOneWidget);
    expect(find.text('api'), findsOneWidget);

    offline.link.up();
    await tester.pumpAndSettle();
    expect(find.text('app'), findsOneWidget);
    await tester.tap(find.text('Sessions'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('offline-banner')), findsNothing);
  });

  testWidgets('the picker offers Pi, and the choice survives a restart', (
    tester,
  ) async {
    FlutterSecureStorage.setMockInitialValues({_selectedKey: 'claude-code'});
    final socket = _OldBridge();
    addTearDown(socket.close);
    final rig = _rig();
    addTearDown(rig.dispose);
    await rig.pump(
      tester,
      const AIBackendScreen(),
      overrides: _oldSide(socket),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('backend-option:pi')));
    await tester.pumpAndSettle();
    expect(await const FlutterSecureStorage().read(key: _selectedKey), 'pi');

    final restarted = ProviderContainer(
      overrides: [
        ..._oldSide(socket),
        contractClientProvider.overrideWithValue(rig.client),
      ],
    );
    addTearDown(restarted.dispose);
    restarted.read(selectedBackendProvider);
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 50)),
    );
    expect(
      restarted.read(selectedBackendProvider),
      const ContractSelection(BackendId.pi),
    );
  });
}
