import 'package:broski/models/agent_type.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/runtime/runtime_model_summary.dart';
import 'package:broski/screens/chat/pi_durable_thinking.dart';
import 'package:flutter_test/flutter_test.dart';

RuntimeModelSummary durableModel({
  String id = 'claude-sonnet-4-5',
  String providerId = 'anthropic',
  bool? supportsReasoning,
}) {
  return RuntimeModelSummary(
    id: id,
    backend: AgentType.piDurable,
    label: '$providerId/$id',
    providerId: providerId,
    supportsReasoning: supportsReasoning,
  );
}

void main() {
  final allLevels = PiThinkingLevel.values.map((l) => l.wireValue).toList();

  group('piDurableThinkingVariants', () {
    test('offers every level while the catalog is still loading', () {
      expect(
        piDurableThinkingVariants(models: null, model: 'anthropic/x'),
        allLevels,
      );
      expect(
        piDurableThinkingVariants(models: const [], model: 'anthropic/x'),
        allLevels,
      );
    });

    test('offers every level for a model that reasons', () {
      expect(
        piDurableThinkingVariants(
          models: [durableModel(supportsReasoning: true)],
          model: 'anthropic/claude-sonnet-4-5',
        ),
        allLevels,
      );
    });

    test('offers none for a catalog model that cannot reason', () {
      expect(
        piDurableThinkingVariants(
          models: [durableModel(supportsReasoning: false)],
          model: 'anthropic/claude-sonnet-4-5',
        ),
        isEmpty,
      );
    });

    test('keeps every level for a model the catalog does not describe', () {
      expect(
        piDurableThinkingVariants(
          models: [durableModel(supportsReasoning: false)],
          model: 'anthropic/unknown',
        ),
        allLevels,
      );
      expect(
        piDurableThinkingVariants(
          models: [durableModel(supportsReasoning: false)],
          model: null,
        ),
        allLevels,
      );
    });

    test(
      'matches the bare model id as well as the provider-qualified label',
      () {
        expect(
          piDurableThinkingVariants(
            models: [durableModel(supportsReasoning: false)],
            model: 'claude-sonnet-4-5',
          ),
          isEmpty,
        );
      },
    );
  });

  group('piDurableModelRef', () {
    test('qualifies the model with its provider', () {
      expect(piDurableModelRef(durableModel()), 'anthropic/claude-sonnet-4-5');
    });

    test('falls back to the bare id when the catalog has no provider', () {
      expect(
        piDurableModelRef(durableModel(providerId: '')),
        'claude-sonnet-4-5',
      );
    });
  });
}
