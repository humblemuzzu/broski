import 'package:broski/models/pi.dart';
import 'package:broski/models/pi_model_catalogue.dart';
import 'package:broski/theme/theme.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:broski/widgets/pi/pi_selected_model_tile.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const PiModelSelection mutableRow = PiModelSelection(
  pattern: 'river/deepseek-ai/DeepSeek-V4.1-Flash',
  label: 'DeepSeek V4.1 Flash — River',
  name: 'DeepSeek V4.1 Flash — River',
  provider: 'river',
  modelId: 'deepseek-ai/DeepSeek-V4.1-Flash',
  unavailableReason: 'No API key — set RIVER_API_KEY, or sign in with `pi`',
);

const PiModelSelection staleRow = PiModelSelection(
  pattern: 'gone/provider/model',
  label: 'gone/provider/model',
  unavailableReason: "Not in Pi's catalogue",
);

const PiModel runnableModel = PiModel(
  id: 'deepseek-flash',
  name: 'DeepSeek V4.1 Flash',
  provider: 'deepseek',
  api: 'openai-completions',
  contextWindow: 200000,
  maxTokens: 8000,
  reasoning: true,
  input: ['text'],
  cost: PiModelCost(),
);

const PiModelSelection runnableRow = PiModelSelection(
  pattern: 'deepseek/deepseek-flash',
  label: 'DeepSeek V4.1 Flash',
  name: 'DeepSeek V4.1 Flash',
  provider: 'deepseek',
  modelId: 'deepseek-flash',
  available: true,
);

Future<void> pumpTile(
  WidgetTester tester,
  PiModelSelection selection, {
  PiModel? model,
  VoidCallback? onTap,
}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: BroskiTheme.fromOpenCodeTheme(opencodeDarkTheme),
      home: Scaffold(
        body: PiSelectedModelTile(
          selection: selection,
          selected: false,
          model: model,
          onTap: onTap,
        ),
      ),
    ),
  );
}

void main() {
  testWidgets(
    'a row whose provider is not signed in keeps its name and says why',
    (tester) async {
      await pumpTile(tester, mutableRow);

      expect(find.text('DeepSeek V4.1 Flash — River'), findsOneWidget);
      expect(
        find.text(
          'river • No API key — set RIVER_API_KEY, or sign in with `pi`',
        ),
        findsOneWidget,
      );
      expect(find.text('unavailable'), findsOneWidget);
      expect(find.text('river/deepseek-ai/DeepSeek-V4.1-Flash'), findsNothing);
    },
  );

  testWidgets(
    'an entry nothing in the catalogue matches shows the pattern and a reason',
    (tester) async {
      await pumpTile(tester, staleRow);

      expect(find.text('gone/provider/model'), findsOneWidget);
      expect(find.text("Not in Pi's catalogue"), findsOneWidget);
    },
  );

  testWidgets('an unavailable row is inert and never calls onTap', (
    tester,
  ) async {
    var taps = 0;
    await pumpTile(tester, mutableRow, onTap: () => taps++);

    await tester.tap(find.text('DeepSeek V4.1 Flash — River'));
    await tester.pump();

    expect(taps, 0);
  });

  testWidgets('a runnable row is tappable and shows its catalogue details', (
    tester,
  ) async {
    var taps = 0;
    await pumpTile(
      tester,
      runnableRow,
      model: runnableModel,
      onTap: () => taps++,
    );

    expect(find.text('DeepSeek V4.1 Flash'), findsOneWidget);
    expect(find.text('unavailable'), findsNothing);

    await tester.tap(find.text('DeepSeek V4.1 Flash'));
    await tester.pump();

    expect(taps, 1);
  });
}
