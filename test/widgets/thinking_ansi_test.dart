import 'package:broski/models/message.dart';
import 'package:broski/theme/theme.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:broski/widgets/chat/compact_thinking_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The sequence a provider wrote into this session's thinking blocks, verbatim.
const String colouredThinking =
    '\u001b[38;2;215;153;33mThinking:\u001b[39m '
    '\u001b[38;2;168;153;132mThe user is asking…\u001b[39m';

ChatMessage thinkingMessage(String thinking) => ChatMessage(
  id: 'pi-0',
  sessionId: 'pi-1',
  role: MessageRole.assistant,
  createdAt: DateTime(2026),
  text: '',
  reasoningParts: [ReasoningPart(id: 'r-0', messageId: 'pi-0', text: thinking)],
);

Future<void> pumpThinking(WidgetTester tester, String thinking) async {
  await tester.pumpWidget(
    ProviderScope(
      child: MaterialApp(
        theme: BroskiTheme.fromOpenCodeTheme(opencodeDarkTheme),
        home: Scaffold(
          body: CompactThinkingCard(message: thinkingMessage(thinking)),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('a coloured thinking preview shows the words, not the codes', (
    tester,
  ) async {
    await pumpThinking(tester, colouredThinking);

    expect(find.text('Thinking: The user is asking…'), findsOneWidget);
    expect(find.textContaining('\u001b'), findsNothing);
    expect(find.textContaining('38;2;'), findsNothing);
  });

  testWidgets('the expanded thinking sheet shows the same clean text', (
    tester,
  ) async {
    await pumpThinking(tester, colouredThinking);

    await tester.tap(find.byType(CompactThinkingCard));
    await tester.pumpAndSettle();

    expect(find.text('Thinking: The user is asking…'), findsWidgets);
    expect(find.textContaining('\u001b'), findsNothing);
  });

  testWidgets('thinking without a sequence is untouched', (tester) async {
    await pumpThinking(tester, 'Thinking: the plain case');
    expect(find.text('Thinking: the plain case'), findsOneWidget);
  });
}
