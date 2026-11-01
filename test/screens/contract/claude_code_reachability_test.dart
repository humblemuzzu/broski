import 'dart:async';

import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/main_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';
import '../../support/fake_websocket.dart';

/// What the new Claude Code declares (`backends/claude-code/traits.ts`
/// `CLAUDE_CODE_TRAITS`, with the custom tools port, as production gives it).
final _claudeCode = Capabilities(
  streamText: true,
  streamThinking: true,
  promptModes: const [PromptMode.start, PromptMode.steer, PromptMode.queue],
  attachments: const [AttachmentKind.image],
  mentions: const [MentionKind.file, MentionKind.agent],
  commands: true,
  queue: true,
  interactions: const [
    InteractionKind.toolPermission,
    InteractionKind.questions,
    InteractionKind.planApproval,
    InteractionKind.form,
    InteractionKind.externalUrl,
    InteractionKind.confirm,
  ],
  modelSwitch: ModelSwitchTiming.nextRequest,
  thinking: true,
  children: true,
  usage: true,
  plan: false,
  planProposals: false,
  externalLive: false,
  durableRuns: false,
  extensions: const [ExtensionKind.rateLimit, ExtensionKind.promptSuggestion],
  backendOps: [
    for (final op in [
      'rewind_files',
      'session_settings',
      'changed_files',
      'refresh_models',
      'config_files',
      'config_file',
      'settings_overview',
      'mcp_servers',
      'plugins',
      'tasks',
      'context_usage',
      'custom_tools',
      'custom_tool',
    ])
      BackendOpKind.fromJson(op),
  ],
  fork: true,
  rename: true,
  delete: true,
  archive: false,
);

const _row = SessionSummary(
  session: SessionRef(backend: BackendId.claudeCode, sessionId: 'c1'),
  title: SessionTitle(text: 'Fix the build', source: TitleSource.user),
  cwd: '/work/app',
  updatedAt: 1,
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.broski,
);

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

Finder _key(String key) => find.byKey(ValueKey(key));

/// Closes the sheet that holds [key].
Future<void> _close(WidgetTester tester, String key) async {
  Navigator.of(tester.element(_key(key))).pop();
  await tester.pumpAndSettle();
}

Future<WidgetRig> _shell(WidgetTester tester) async {
  FlutterSecureStorage.setMockInitialValues({
    'broski_selected_agent_type': 'contract:claude-code',
  });
  tester.view.physicalSize = const Size(1200, 2600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final socket = _OldBridge();
  addTearDown(socket.close);
  final rig = WidgetRig(capabilities: _claudeCode);
  addTearDown(rig.dispose);
  rig.bridge
    ..on<BackendsListRequest>(
      (request) => BackendsListResponse(
        requestId: request.requestId,
        backends: [
          BackendDescriptor(
            id: BackendId.claudeCode,
            capabilities: _claudeCode,
          ),
        ],
      ),
    )
    ..on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: const SessionsListed(page: SessionPage(items: [_row])),
      ),
    )
    ..on<SessionGetRequest>(
      (request) => SessionGetResponse(
        requestId: request.requestId,
        result: const SessionFound(summary: _row),
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
    ..on<TranscriptReadRequest>(
      (request) => pageAnswer(request, [
        const UserMessageItem(
          id: 'u1',
          text: 'Read the readme',
          attachments: [],
        ),
      ]),
    );
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
  return rig;
}

void main() {
  testWidgets('every operation the new Claude Code declares has a place in '
      'the normal app', (tester) async {
    await _shell(tester);
    await tester.tap(_key('backend-panels'));
    await tester.pumpAndSettle();
    expect(_key('panel:custom_tools'), findsOneWidget);
    await _close(tester, 'panel:custom_tools');

    await tester.tap(_key('session-row:c1'));
    await tester.pumpAndSettle();
    await tester.tap(_key('chat-panels'));
    await tester.pumpAndSettle();
    for (final key in [
      'chat-open-as-fork',
      'panel:session_settings',
      'panel:changed_files',
      'panel:mcp_servers',
      'panel:tasks',
      'panel:context_usage',
      'panel:config_files',
      'panel:settings_overview',
      'panel:plugins',
    ]) {
      expect(_key(key), findsOneWidget, reason: key);
    }
    await _close(tester, 'panel:plugins');

    await tester.tap(_key('chat-settings'));
    await tester.pumpAndSettle();
    expect(_key('model-panel:refresh_models'), findsOneWidget);
    await _close(tester, 'model-panel:refresh_models');

    final actions = find.ancestor(
      of: find.text('Read the readme'),
      matching: find.byWidgetPredicate(
        (widget) =>
            widget is Semantics &&
            (widget.properties.customSemanticsActions?.keys.any(
                  (action) => action.label == 'Actions from here',
                ) ??
                false),
      ),
    );
    tester
        .widget<Semantics>(actions.first)
        .properties
        .customSemanticsActions
        ?.values
        .single();
    await tester.pumpAndSettle();
    expect(_key('item-panel:rewind_files'), findsOneWidget);
    expect(_key('fork:through'), findsOneWidget);
  });
}
