import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

final _offered = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': ['session_settings', 'session_tools', 'system_prompt'],
});

const _watchOnly = SessionCapabilities(
  controllable: false,
  compact: false,
  cancelQueued: false,
);

const _toggles = <SessionSetting>[
  ToggleSetting(
    key: 'auto_compaction',
    label: 'Auto-compact',
    description: 'Compacts when the context gets large',
    enabled: true,
  ),
  ToggleSetting(
    key: 'auto_retry',
    label: 'Auto-retry',
    enabled: false,
    note: 'The project sets this.',
  ),
  ChoiceSetting(
    key: 'steering_mode',
    label: 'Steering mode',
    value: 'one-at-a-time',
    options: [
      Option(value: 'one-at-a-time', label: 'One at a time'),
      Option(value: 'all', label: 'All at once'),
    ],
  ),
];

BackendCallResponse _answer(
  BackendCallRequest request,
  BackendOpResult result,
) => BackendCallResponse(
  requestId: request.requestId,
  result: BackendCallAccepted(result: result),
);

BackendCallResponse _refusal(BackendCallRequest request, String message) =>
    BackendCallResponse(
      requestId: request.requestId,
      result: Rejected(
        rejection: Rejection(code: RejectionCode.busy, message: message),
      ),
    );

Future<WidgetRig> _chat(
  WidgetTester tester, {
  SessionCapabilities session = controllable,
  Capabilities? capabilities,
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(
    capabilities: capabilities ?? _offered,
    session: session,
  );
  addTearDown(rig.dispose);
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

Future<void> _tap(WidgetTester tester, Finder target) async {
  await tester.tap(target);
  await tester.pumpAndSettle();
}

Future<void> _open(WidgetTester tester, String panel) async {
  await _tap(tester, _key('chat-panels'));
  await _tap(tester, _key('panel:$panel'));
}

PiOp _opOf(WidgetRig rig) {
  final call = rig.sent<BackendCallRequest>().call;
  return (call as PiCall).op;
}

void main() {
  group('which panels a session is offered', () {
    test('each of the three is offered to a session that can be driven', () {
      final kinds = [
        for (final panel in panelsAt(
          _offered,
          OpPlace.session,
          controllable: true,
        ))
          panel.kind,
      ];
      expect(kinds, [
        BackendOpKind.sessionSettings,
        BackendOpKind.sessionTools,
        BackendOpKind.systemPrompt,
      ]);
    });

    test('none is offered to a session that can only be watched', () {
      expect(panelsAt(_offered, OpPlace.session), isEmpty);
    });

    test('none is offered by a backend that lists none of them', () {
      expect(
        panelsAt(
          everything,
          OpPlace.session,
          controllable: true,
        ).map((panel) => panel.kind),
        [BackendOpKind.changedFiles],
      );
    });
  });

  testWidgets('the menu lists them for a session that can be driven, and '
      'not for one that is watched', (tester) async {
    await _chat(tester);
    await _tap(tester, _key('chat-panels'));
    for (final panel in [
      'session_settings',
      'session_tools',
      'system_prompt',
    ]) {
      expect(_key('panel:$panel'), findsOneWidget);
    }
  });

  testWidgets('a watched session has no menu of them', (tester) async {
    await _chat(tester, session: _watchOnly);
    await tester.tap(_key('chat-panels'));
    await tester.pumpAndSettle();
    expect(_key('chat-open-as-fork'), findsOneWidget);
    for (final kind in ['session_settings', 'session_tools', 'system_prompt']) {
      expect(_key('panel:$kind'), findsNothing);
    }
  });

  testWidgets('a watched session of a backend that cannot fork has no More', (
    tester,
  ) async {
    await _chat(
      tester,
      session: _watchOnly,
      capabilities: Capabilities.fromJson({
        ..._offered.toJson(),
        'fork': false,
      }),
    );
    expect(_key('chat-panels'), findsNothing);
  });

  group('the settings', () {
    testWidgets('are read when the panel opens, and shown by their shape: '
        'a switch, a note, a row of choices', (tester) async {
      final rig = await _chat(tester);
      rig.bridge.on<BackendCallRequest>(
        (request) =>
            _answer(request, const SessionSettingsResult(settings: _toggles)),
      );
      await _open(tester, 'session_settings');

      expect(_opOf(rig), const SessionSettingsOp(sessionId: 's1'));
      expect(find.text('Auto-compact'), findsOneWidget);
      expect(find.text('Compacts when the context gets large'), findsOneWidget);
      expect(find.text('The project sets this.'), findsOneWidget);
      expect(
        tester.widget<SwitchListTile>(_key('setting:auto_compaction')).value,
        isTrue,
      );
      expect(
        tester.widget<SwitchListTile>(_key('setting:auto_retry')).value,
        isFalse,
      );
      expect(
        tester
            .widget<ChoiceChip>(_key('setting:steering_mode:one-at-a-time'))
            .selected,
        isTrue,
      );
    });

    testWidgets('a switch sends that change, and what the session now has '
        'replaces what was shown', (tester) async {
      final rig = await _chat(tester);
      rig.bridge.on<BackendCallRequest>((request) {
        final op = (request.call as PiCall).op as SessionSettingsOp;
        final change = op.change;
        return _answer(
          request,
          SessionSettingsResult(
            settings: [
              if (change is ToggleChange)
                const ToggleSetting(
                  key: 'auto_compaction',
                  label: 'Auto-compact',
                  enabled: false,
                )
              else
                ..._toggles,
            ],
          ),
        );
      });
      await _open(tester, 'session_settings');
      await _tap(tester, _key('setting:auto_compaction'));

      expect(
        _opOf(rig),
        const SessionSettingsOp(
          sessionId: 's1',
          change: ToggleChange(key: 'auto_compaction', enabled: false),
        ),
      );
      expect(
        tester.widget<SwitchListTile>(_key('setting:auto_compaction')).value,
        isFalse,
      );
      expect(find.text('Auto-retry'), findsNothing);
    });

    testWidgets('a choice sends the value picked', (tester) async {
      final rig = await _chat(tester);
      rig.bridge.on<BackendCallRequest>(
        (request) =>
            _answer(request, const SessionSettingsResult(settings: _toggles)),
      );
      await _open(tester, 'session_settings');
      await _tap(tester, _key('setting:steering_mode:all'));
      expect(
        _opOf(rig),
        const SessionSettingsOp(
          sessionId: 's1',
          change: ChoiceChange(key: 'steering_mode', value: 'all'),
        ),
      );
    });

    testWidgets('a refusal is told in the sheet and leaves the settings as '
        'they were', (tester) async {
      final rig = await _chat(tester);
      var reads = 0;
      rig.bridge.on<BackendCallRequest>(
        (request) => reads++ == 0
            ? _answer(request, const SessionSettingsResult(settings: _toggles))
            : _refusal(request, 'The extensions are still starting.'),
      );
      await _open(tester, 'session_settings');
      await _tap(tester, _key('setting:auto_retry'));

      expect(find.text('The extensions are still starting.'), findsOneWidget);
      expect(
        tester.widget<SwitchListTile>(_key('setting:auto_retry')).value,
        isFalse,
      );
    });

    testWidgets('a refused read shows the refusal and no sheet of settings', (
      tester,
    ) async {
      final rig = await _chat(tester);
      rig.bridge.on<BackendCallRequest>(
        (request) => _refusal(request, 'Another client made this session.'),
      );
      await _open(tester, 'session_settings');
      expect(find.text('Auto-compact'), findsNothing);
      expect(find.text('Another client made this session.'), findsOneWidget);
    });
  });

  group('the tools', () {
    const tools = SessionToolsResult(
      tools: [
        SessionTool(
          name: 'read',
          description: 'Read a file',
          active: true,
          group: 'Built-in',
        ),
        SessionTool(
          name: 'bash',
          description: 'Run a command',
          active: false,
          group: 'Built-in',
        ),
        SessionTool(name: 'deploy', description: 'Ship it', active: true),
      ],
      omitted: 7,
    );

    testWidgets('are listed by group with a switch each, and say how many '
        'more there are', (tester) async {
      final rig = await _chat(tester);
      rig.bridge.on<BackendCallRequest>((request) => _answer(request, tools));
      await _open(tester, 'session_tools');

      expect(_opOf(rig), const SessionToolsOp(sessionId: 's1'));
      expect(find.text('2 of 3 tools on'), findsOneWidget);
      expect(find.text('Built-in'), findsOneWidget);
      expect(find.text('Other'), findsOneWidget);
      expect(tester.widget<SwitchListTile>(_key('tool:read')).value, isTrue);
      expect(tester.widget<SwitchListTile>(_key('tool:bash')).value, isFalse);
      expect(find.text('7 more tools are not listed.'), findsOneWidget);
    });

    testWidgets('a switch turns that tool on or off and shows the new '
        'list', (tester) async {
      final rig = await _chat(tester);
      rig.bridge.on<BackendCallRequest>((request) {
        final op = (request.call as PiCall).op as SessionToolsOp;
        return _answer(
          request,
          op.change == null
              ? tools
              : const SessionToolsResult(
                  tools: [
                    SessionTool(
                      name: 'bash',
                      description: 'Run a command',
                      active: true,
                    ),
                  ],
                ),
        );
      });
      await _open(tester, 'session_tools');
      await _tap(tester, _key('tool:bash'));

      expect(
        _opOf(rig),
        const SessionToolsOp(
          sessionId: 's1',
          change: ToolChange(name: 'bash', active: true),
        ),
      );
      expect(tester.widget<SwitchListTile>(_key('tool:bash')).value, isTrue);
      expect(_key('tool:read'), findsNothing);
      expect(_key('tools-omitted'), findsNothing);
    });
  });

  group('the system prompt', () {
    testWidgets('is shown read-only, with how much of it is shown and a way '
        'to the rest', (tester) async {
      final rig = await _chat(tester);
      rig.bridge.on<BackendCallRequest>((request) {
        final offset =
            ((request.call as PiCall).op as SystemPromptOp).offset ?? 0;
        return _answer(
          request,
          offset == 0
              ? const SystemPromptResult(
                  text: 'You are an expert. ',
                  offset: 0,
                  totalChars: 30,
                  nextOffset: 19,
                )
              : const SystemPromptResult(
                  text: 'Be brief.',
                  offset: 19,
                  totalChars: 28,
                ),
        );
      });
      await _open(tester, 'system_prompt');

      expect(_opOf(rig), const SystemPromptOp(sessionId: 's1'));
      expect(find.text('You are an expert. '), findsOneWidget);
      expect(
        find.text('The first 19 of 30 characters are shown.'),
        findsOneWidget,
      );

      await _tap(tester, _key('text-pages-more'));
      expect(_opOf(rig), const SystemPromptOp(sessionId: 's1', offset: 19));
      expect(find.text('You are an expert. Be brief.'), findsOneWidget);
      expect(find.text('All 28 characters are shown.'), findsOneWidget);
      expect(_key('text-pages-more'), findsNothing);
    });

    testWidgets('a short prompt has no way to more', (tester) async {
      final rig = await _chat(tester);
      rig.bridge.on<BackendCallRequest>(
        (request) => _answer(
          request,
          const SystemPromptResult(text: 'Be brief.', offset: 0, totalChars: 9),
        ),
      );
      await _open(tester, 'system_prompt');
      expect(find.text('All 9 characters are shown.'), findsOneWidget);
      expect(_key('text-pages-more'), findsNothing);
    });
  });
}
