import 'package:broski/models/agent_type.dart';
import 'package:broski/models/pi_durable/pi_durable_usage.dart';
import 'package:broski/models/runtime/runtime_model_summary.dart';
import 'package:broski/utils/format_utils.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, dynamic> usageWith({required Map<String, dynamic> models}) => {
  'models': models,
  'tools': const {},
};

void main() {
  group('pi-durable usage → pill', () {
    test('sums every billed model into the pill numbers', () {
      final usage = PiDurableUsage.fromUsage(
        usageWith(
          models: {
            'anthropic/claude-sonnet-4': {
              'input': 1000,
              'output': 200,
              'cacheRead': 500,
              'cacheWrite': 50,
              'totalTokens': 1750,
              'cost': {'total': 0.0123},
              'includedInPlan': false,
            },
            'openai/gpt-5': {
              'input': 300,
              'output': 20,
              'cacheRead': 0,
              'cacheWrite': 0,
              'totalTokens': 320,
              'cost': {'total': 0.001},
              'includedInPlan': false,
            },
          },
        ),
      );

      expect(usage.hasUsage, isTrue);
      expect(usage.input, 1300);
      expect(usage.output, 220);
      expect(usage.cacheRead, 500);
      expect(usage.cacheWrite, 50);
      expect(usage.totalTokens, 2070);
      expect(usage.costUsd, closeTo(0.0133, 0.00001));
      expect(usage.includedInPlan, isFalse);
      expect(usage.costLabel, '\$0.0133');
    });

    test('a subscription shows the plan instead of the catalog price', () {
      final usage = PiDurableUsage.fromUsage(
        usageWith(
          models: {
            'anthropic/claude-sonnet-4': {
              'input': 1000,
              'output': 200,
              'cacheRead': 500,
              'cacheWrite': 50,
              'totalTokens': 1750,
              'includedInPlan': true,
            },
          },
        ),
      );

      expect(usage.includedInPlan, isTrue);
      expect(usage.costUsd, 0);
      expect(usage.costLabel, 'Included in plan');
    });

    test('one paid model makes the whole pill a price', () {
      final usage = PiDurableUsage.fromUsage(
        usageWith(
          models: {
            'anthropic/claude-sonnet-4': {'includedInPlan': true},
            'openai/gpt-5': {
              'cost': {'total': 0.5},
              'includedInPlan': false,
            },
          },
        ),
      );

      expect(usage.includedInPlan, isFalse);
      expect(usage.costLabel, '\$0.5000');
    });

    test('no reported usage yields an empty pill', () {
      expect(PiDurableUsage.fromUsage(null).hasUsage, isFalse);
      expect(PiDurableUsage.fromUsage(const {}).hasUsage, isFalse);
      expect(
        PiDurableUsage.fromUsage(usageWith(models: const {})).hasUsage,
        isFalse,
      );
    });
  });

  group('pi-durable usage → SessionContext', () {
    test(
      'context tokens come from the runtime state, not cumulative tokens',
      () {
        final usage = PiDurableUsage.fromUsage(
          usageWith(
            models: {
              'anthropic/claude-sonnet-4': {
                'input': 1000,
                'output': 200,
                'cacheRead': 500,
                'cacheWrite': 50,
                'totalTokens': 1750,
                'includedInPlan': true,
              },
            },
          ),
        );

        final context = usage.toSessionContext(
          contextTokens: 4200,
          contextWindow: 200000,
        );

        expect(context.tokens.contextTokens, 4200);
        expect(context.tokens.total, 1200);
        expect(context.tokens.contextWindow, 200000);
        expect(context.contextUsagePercent, closeTo(2.1, 0.001));
      },
    );

    test('falls back to cumulative tokens before the first answer', () {
      final usage = PiDurableUsage.fromUsage(
        usageWith(
          models: {
            'anthropic/claude-sonnet-4': {
              'input': 1000,
              'output': 200,
              'totalTokens': 1200,
              'includedInPlan': true,
            },
          },
        ),
      );

      final context = usage.toSessionContext(
        contextTokens: null,
        contextWindow: 100000,
      );
      expect(context.tokens.contextTokens, 1200);
    });
  });

  group('pi-durable context window lookup', () {
    const models = [
      RuntimeModelSummary(
        id: 'claude-sonnet-4',
        backend: AgentType.piDurable,
        label: 'anthropic/claude-sonnet-4',
        providerId: 'anthropic',
        contextWindow: 200000,
      ),
      RuntimeModelSummary(
        id: 'gpt-5',
        backend: AgentType.piDurable,
        label: 'openai/gpt-5',
      ),
    ];

    test('matches by provider label', () {
      expect(
        piDurableContextWindow(models, 'anthropic/claude-sonnet-4'),
        200000,
      );
    });

    test('falls back to the default for an unknown or missing model', () {
      expect(
        piDurableContextWindow(models, 'openai/gpt-5'),
        kDefaultContextWindow,
      );
      expect(piDurableContextWindow(models, null), kDefaultContextWindow);
    });
  });
}
