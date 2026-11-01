import 'package:broski/agent/session/session_notices.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('each rate-limit window keeps its newest, and a prompt suggestion '
      'replaces the one before', () {
    var kept = withExtension(
      const {},
      const RateLimitUpdate(window: 'five_hour', usedPercent: 10),
    );
    kept = withExtension(
      kept,
      const RateLimitUpdate(window: 'seven_day', usedPercent: 3),
    );
    kept = withExtension(kept, const PromptSuggestion(text: 'Run the tests'));
    kept = withExtension(kept, const PromptSuggestion(text: 'Commit it'));

    expect(kept.values, [
      const RateLimitUpdate(window: 'five_hour', usedPercent: 10),
      const RateLimitUpdate(window: 'seven_day', usedPercent: 3),
      const PromptSuggestion(text: 'Commit it'),
    ]);
  });
}
