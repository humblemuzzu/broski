import 'package:broski/models/pi.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/sheets/pi_model_sheet.dart';
import 'package:broski/theme/theme.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_websocket.dart';

Map<String, dynamic> _model(String provider, String id, String name) =>
    <String, dynamic>{
      'id': id,
      'name': name,
      'provider': provider,
      'api': 'anthropic-messages',
      'contextWindow': 1000000,
      'maxTokens': 64000,
      'reasoning': true,
      'input': <String>['text', 'image'],
      'cost': <String, dynamic>{
        'input': 3,
        'output': 15,
        'cacheRead': 0,
        'cacheWrite': 0,
      },
      'authenticated': true,
      'isOAuth': false,
    };

Map<String, dynamic> _catalogueReply() => <String, dynamic>{
  'data': <Map<String, dynamic>>[
    _model('anthropic', 'claude-opus-5-5', 'Opus 5.5'),
    _model('anthropic', 'claude-sonnet-5-5', 'Sonnet 5.5'),
    _model('deepseek', 'deepseek-flash', 'DeepSeek Flash'),
  ],
  'selected': <Map<String, dynamic>>[
    <String, dynamic>{
      'pattern': 'anthropic/claude-opus-5-5',
      'label': 'Opus 5.5',
      'provider': 'anthropic',
      'modelId': 'claude-opus-5-5',
      'thinkingLevel': null,
      'available': true,
    },
    <String, dynamic>{
      'pattern': 'river/deepseek-ai/DeepSeek-V4.1-Flash',
      'label': 'DeepSeek V4.1 Flash — River',
      'name': 'DeepSeek V4.1 Flash — River',
      'provider': 'river',
      'modelId': 'deepseek-ai/DeepSeek-V4.1-Flash',
      'thinkingLevel': null,
      'available': false,
      'unavailableReason':
          'No API key — set RIVER_API_KEY, or sign in with `pi`',
    },
  ],
  'hidden': <String, dynamic>{
    'count': 1,
    'providers': <String>['river'],
  },
  'defaultModel': <String, dynamic>{
    'provider': 'anthropic',
    'modelId': 'claude-opus-5-5',
    'thinkingLevel': 'high',
  },
};

Future<void> _pumpSheet(WidgetTester tester, FakeWebSocket socket) async {
  await tester.pumpWidget(
    ProviderScope(
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
      child: MaterialApp(
        theme: BroskiTheme.fromOpenCodeTheme(opencodeDarkTheme),
        home: const Scaffold(body: PiModelSheet()),
      ),
    ),
  );

  final container = ProviderScope.containerOf(
    tester.element(find.byType(PiModelSheet)),
  );
  container
      .read(chatSessionProvider.notifier)
      .setPiSession(
        sessionId: 'pi-1',
        cwd: '/project',
        model: 'anthropic/claude-opus-5-5',
        thinkingLevel: PiThinkingLevel.high,
      );
  await tester.pump();

  socket.deliver({
    ..._catalogueReply(),
    'type': 'pi_models',
    'requestId': socket.lastRequestId,
  });
  await tester.pump();
}

void main() {
  setUp(() => FlutterSecureStorage.setMockInitialValues({}));

  testWidgets(
    'shows the user models first, the current one marked with its thinking level',
    (tester) async {
      final socket = FakeWebSocket();
      addTearDown(socket.close);
      await _pumpSheet(tester, socket);

      expect(socket.sent.first['type'], 'pi_list_models');
      expect(find.text('YOUR MODELS'), findsOneWidget);
      expect(find.text('ALL MODELS'), findsOneWidget);
      expect(find.text('Opus 5.5'), findsOneWidget);
      expect(find.text('DeepSeek V4.1 Flash — River'), findsOneWidget);
      expect(
        find.text(
          'river • No API key — set RIVER_API_KEY, or sign in with `pi`',
        ),
        findsOneWidget,
      );
      expect(
        find.text('1 model hidden — not signed in for river'),
        findsOneWidget,
      );
      expect(find.text('unavailable'), findsOneWidget);
      expect(find.text('High'), findsOneWidget);

      // The user's order is the reply's order, and the unselected catalogue row comes after it.
      final opusY = tester.getTopLeft(find.text('Opus 5.5')).dy;
      final sonnetY = tester.getTopLeft(find.text('Sonnet 5.5')).dy;
      expect(opusY, lessThan(sonnetY));
    },
  );

  testWidgets('a search filters the catalogue and leaves the user list alone', (
    tester,
  ) async {
    final socket = FakeWebSocket();
    addTearDown(socket.close);
    await _pumpSheet(tester, socket);

    expect(find.text('DeepSeek Flash'), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'sonnet');
    await tester.pump();

    expect(find.text('Sonnet 5.5'), findsOneWidget);
    expect(find.text('Opus 5.5'), findsOneWidget);
    expect(find.text('DeepSeek Flash'), findsNothing);
    expect(find.text('1 model hidden — not signed in for river'), findsNothing);
  });

  testWidgets('tapping a catalogue model sets it on the bridge', (
    tester,
  ) async {
    final socket = FakeWebSocket();
    addTearDown(socket.close);
    await _pumpSheet(tester, socket);

    await tester.tap(find.text('Sonnet 5.5'));
    await tester.pump();

    final setModel = socket.sent.lastWhere(
      (message) => message['type'] == 'pi_set_model',
    );
    expect(setModel['provider'], 'anthropic');
    expect(setModel['modelId'], 'claude-sonnet-5-5');
  });

  testWidgets(
    'the refresh button asks the bridge to refresh Pi\'s catalogues',
    (tester) async {
      final socket = FakeWebSocket();
      addTearDown(socket.close);
      await _pumpSheet(tester, socket);

      await tester.tap(find.text('Refresh'));
      await tester.pump();

      expect(socket.sent.last['type'], 'pi_refresh_models');

      socket.deliver({
        ..._catalogueReply(),
        'type': 'pi_models_refreshed',
        'requestId': socket.lastRequestId,
      });
      await tester.pump();

      expect(find.text('Pi offers 3 models here'), findsOneWidget);
    },
  );
}
