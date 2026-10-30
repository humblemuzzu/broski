import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/pickers/session_settings_fields.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

ModelSummary _model(String id, {String? providerId, String? reason}) =>
    ModelSummary(
      id: id,
      displayName: 'Model $id',
      providerId: providerId,
      providerName: providerId == null ? null : 'Provider $providerId',
      thinking: const ThinkingSpec(options: []),
      isDefault: false,
      unavailableReason: reason,
    );

final _models = [
  _model('a/usable-one'),
  _model('a/usable-two'),
  _model(
    'm/locked-one',
    providerId: 'm',
    reason: 'Not signed in to Provider m: sign in with /login in pi.',
  ),
  _model(
    'm/locked-two',
    providerId: 'm',
    reason: 'Not signed in to Provider m: sign in with /login in pi.',
  ),
];

final _refreshable = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': ['refresh_models'],
});

Future<WidgetRig> _settings(
  WidgetTester tester, {
  List<ModelSummary>? models,
  Capabilities capabilities = everything,
  int minor = contractProtocolMinor,
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(capabilities: capabilities, helloMinor: minor);
  addTearDown(rig.dispose);
  rig.bridge
    ..on<ModelsListRequest>(
      (request) => ModelsListResponse(
        requestId: request.requestId,
        result: ModelsListed(models: models ?? _models),
      ),
    )
    ..on<ModesListRequest>(
      (request) => ModesListResponse(
        requestId: request.requestId,
        result: const ModesListed(modes: []),
      ),
    );
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  await tester.tap(find.byKey(const ValueKey('chat-settings')));
  await tester.pumpAndSettle();
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

void main() {
  testWidgets('the models that can be used are chosen as before, and the ones '
      'that cannot are not chips at all', (tester) async {
    final rig = await _settings(tester);
    expect(_key('model:a/usable-one'), findsOneWidget);
    expect(_key('model:a/usable-two'), findsOneWidget);
    expect(_key('model:m/locked-one'), findsNothing);

    rig.bridge.on<ModelSetRequest>(
      (request) => ModelSetResponse(
        requestId: request.requestId,
        result: const ActionAccepted(),
      ),
    );
    await tester.tap(_key('model:a/usable-two'));
    await tester.pump();
    expect(rig.sent<ModelSetRequest>().modelId, 'a/usable-two');
  });

  testWidgets('the models that cannot be used are listed apart, grouped by '
      'provider, each group saying what is missing', (tester) async {
    await _settings(tester);
    expect(find.text('Not available yet (2)'), findsOneWidget);
    expect(_key('unavailable-provider:m'), findsNothing);

    await tester.tap(_key('unavailable-models'));
    await tester.pumpAndSettle();
    expect(find.text('Provider m'), findsOneWidget);
    expect(
      find.text('Not signed in to Provider m: sign in with /login in pi.'),
      findsOneWidget,
    );
    await tester.tap(_key('unavailable-provider:m'));
    await tester.pumpAndSettle();
    expect(find.text('Model m/locked-one'), findsOneWidget);
    expect(find.text('Model m/locked-two'), findsOneWidget);
  });

  testWidgets('an unavailable model cannot be chosen', (tester) async {
    final rig = await _settings(tester);
    await tester.tap(_key('unavailable-models'));
    await tester.pumpAndSettle();
    await tester.tap(_key('unavailable-provider:m'));
    await tester.pumpAndSettle();
    await tester.tap(_key('unavailable-model:m/locked-one'));
    await tester.pump();
    expect(rig.link.sent.whereType<ModelSetRequest>(), isEmpty);
    final tile = tester.widget<ListTile>(
      _key('unavailable-model:m/locked-one'),
    );
    expect(tile.enabled, isFalse);
    expect(tile.onTap, isNull);
  });

  testWidgets('with every model usable there is nothing to show beside them', (
    tester,
  ) async {
    await _settings(tester, models: [_model('a/usable-one')]);
    expect(_key('unavailable-models'), findsNothing);
  });

  testWidgets('the unavailable models are asked for of a Mac that knows them, '
      'and only of one', (tester) async {
    final modern = await _settings(tester);
    expect(modern.sent<ModelsListRequest>().includeUnavailable, isTrue);
  });

  testWidgets('an older Mac is not sent a field it does not know', (
    tester,
  ) async {
    final older = await _settings(tester, minor: 2);
    expect(older.sent<ModelsListRequest>().includeUnavailable, isNull);
    expect(_key('model:a/usable-one'), findsOneWidget);
  });

  testWidgets('the catalogues can be refreshed from the picker, and it says '
      'which could not be', (tester) async {
    final rig = await _settings(tester, capabilities: _refreshable);
    rig.bridge.on<BackendCallRequest>(
      (request) => BackendCallResponse(
        requestId: request.requestId,
        result: const BackendCallAccepted(
          result: ModelsRefreshed(problems: ['openrouter: timed out']),
        ),
      ),
    );
    await tester.tap(_key('model-panel:refresh_models'));
    await tester.pumpAndSettle();
    expect(
      rig.sent<BackendCallRequest>().call,
      const PiCall(op: RefreshModelsOp()),
    );
    expect(
      find.text('Some catalogues could not be refreshed:'),
      findsOneWidget,
    );
    expect(find.text('openrouter: timed out'), findsOneWidget);
  });

  testWidgets('a backend with no refresh offers none', (tester) async {
    await _settings(tester);
    expect(_key('model-panel:refresh_models'), findsNothing);
  });

  testWidgets('a new session can start only on a model that can be used, and '
      'sees the others apart', (tester) async {
    final rig = WidgetRig(helloMinor: contractProtocolMinor);
    addTearDown(rig.dispose);
    rig.bridge
      ..on<ModelsListRequest>(
        (request) => ModelsListResponse(
          requestId: request.requestId,
          result: ModelsListed(models: _models),
        ),
      )
      ..on<ModesListRequest>(
        (request) => ModesListResponse(
          requestId: request.requestId,
          result: const ModesListed(modes: []),
        ),
      );
    await rig.pump(
      tester,
      Scaffold(
        body: SingleChildScrollView(
          child: SessionSettingsFields(
            backend: BackendDescriptor(
              id: sessionRef.backend,
              capabilities: everything,
            ),
            cwd: '/work',
            choice: const SessionSettingsChoice(),
            onChanged: (_) {},
          ),
        ),
      ),
    );
    await tester.tap(_key('new-session-model'));
    await tester.pumpAndSettle();
    expect(find.text('Model a/usable-one'), findsWidgets);
    expect(find.text('Model m/locked-one'), findsNothing);
    await tester.tapAt(const Offset(5, 5));
    await tester.pumpAndSettle();
    expect(find.text('Not available yet (2)'), findsOneWidget);
  });
}
