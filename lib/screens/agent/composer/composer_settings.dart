import 'package:broski/agent/catalog/catalog_lists.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What the input bar's chips show of a session's settings: the model's
/// name, the thinking levels it offers and the one chosen, and the first
/// mode axis the backend declares with the value in effect.
typedef ComposerSettings = ({
  String? model,
  List<String> thinkingLevels,
  String? thinking,
  ModeAxis? modeAxis,
  String? mode,
});

ComposerSettings composerSettings(
  WidgetRef ref,
  AgentSessionState state,
  Capabilities capabilities,
) {
  final key = (backend: state.ref.backend, cwd: state.summary?.cwd);
  final snapshot = state.snapshot;
  final models = switch (ref.watch(modelsProvider(key)).valueOrNull) {
    Done(value: final list) => list,
    _ => const <ModelSummary>[],
  };
  final model = models.where((m) => m.id == snapshot.modelId).firstOrNull;
  final axis = switch (ref.watch(modesProvider(key)).valueOrNull) {
    Done(value: final axes) => axes.firstOrNull,
    _ => null,
  };
  return (
    model: model?.displayName ?? snapshot.modelId,
    thinkingLevels: capabilities.thinking
        ? [
            for (final option
                in model?.thinking.options ?? const <ThinkingOption>[])
              option.value,
          ]
        : const [],
    thinking: snapshot.thinking,
    modeAxis: axis,
    mode: axis == null
        ? null
        : snapshot.modes.where((m) => m.axis == axis.id).firstOrNull?.value ??
              axis.defaultValue,
  );
}
