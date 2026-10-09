import 'package:broski/models/agent_type.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/runtime/runtime_model_summary.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_durable/pi_durable_providers.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The label `unified_set_model` accepts for [model]: `provider/modelId`.
String piDurableModelRef(RuntimeModelSummary model) {
  final provider = model.providerId;
  return provider == null || provider.isEmpty
      ? model.id
      : '$provider/${model.id}';
}

/// Thinking levels the durable backend accepts for [model].
///
/// [models] is the durable model catalog. Levels are only meaningful on a model
/// that reasons, so a catalog model that cannot reason offers none; an unknown
/// or not-yet-loaded catalog keeps every level.
List<String> piDurableThinkingVariants({
  required List<RuntimeModelSummary>? models,
  required String? model,
}) {
  final all = PiThinkingLevel.values.map((level) => level.wireValue).toList();
  if (models == null || models.isEmpty || model == null || model.isEmpty) {
    return all;
  }
  for (final entry in models) {
    if (entry.id != model && piDurableModelRef(entry) != model) continue;
    return entry.supportsReasoning == false ? const [] : all;
  }
  return all;
}

/// Levels the composer offers for the durable session's current model, from
/// the durable model catalog.
List<String> piDurableThinkingVariantsOf(WidgetRef ref) =>
    piDurableThinkingVariants(
      models: ref.watch(piDurableModelsProvider).valueOrNull,
      model: ref.watch(chatSessionProvider.select((s) => s.pdModel)),
    );

/// Pushes a model and/or thinking level to the open durable session over
/// `unified_set_model` and mirrors the change into the chat state.
Future<bool> applyPiDurableModelChange({
  required WidgetRef ref,
  required String? model,
  required PiThinkingLevel thinkingLevel,
}) async {
  final sessionId = ref.read(chatSessionProvider).pdSessionId ?? '';
  if (sessionId.isEmpty) return false;
  final ok = await ref
      .read(bridgeServiceProvider)
      .unifiedSetModel(
        backend: AgentType.piDurable,
        model: model ?? '',
        sessionId: sessionId,
        thinkingLevel: thinkingLevel.wireValue,
      );
  if (!ok) return false;
  ref
      .read(chatSessionProvider.notifier)
      .setPiDurableModel(model, thinkingLevel: thinkingLevel);
  return true;
}

/// Thinking-level change from the composer chip: the session keeps its model.
void setPiDurableThinkingLevel({
  required WidgetRef ref,
  required String? wireValue,
}) {
  if (wireValue == null) return;
  final level = PiThinkingLevel.fromWireValue(wireValue);
  applyPiDurableModelChange(
    ref: ref,
    model: ref.read(chatSessionProvider).pdModel,
    thinkingLevel: level,
  );
}
