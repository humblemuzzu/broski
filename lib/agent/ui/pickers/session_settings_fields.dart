import 'package:broski/agent/catalog/catalog_lists.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/ui/pickers/model_picker_extras.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The model, thinking and modes a new session starts with; anything left
/// unchosen takes the backend's default.
final class SessionSettingsChoice {
  const SessionSettingsChoice({
    this.model,
    this.thinking,
    this.modes = const {},
  });

  final ModelSummary? model;
  final String? thinking;
  final Map<ModeAxisId, String> modes;

  NewSessionOptions options(String cwd) => NewSessionOptions(
    cwd: cwd,
    modelId: model?.id,
    thinking: thinking,
    modes: modes.isEmpty
        ? null
        : [
            for (final MapEntry(:key, :value) in modes.entries)
              ModeSetting(axis: key, value: value),
          ],
  );
}

/// Pickers for what a backend lets a new session choose in [cwd]; thinking
/// only where the backend has it and the chosen model offers levels.
class SessionSettingsFields extends ConsumerWidget {
  const SessionSettingsFields({
    super.key,
    required this.backend,
    required this.cwd,
    required this.choice,
    required this.onChanged,
  });

  final BackendDescriptor backend;
  final String cwd;
  final SessionSettingsChoice choice;
  final ValueChanged<SessionSettingsChoice> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final key = (backend: backend.id, cwd: cwd);
    final models = ref.watch(modelsProvider(key)).valueOrNull;
    final modes = ref.watch(modesProvider(key)).valueOrNull;
    final levels = choice.model?.thinking.options ?? const <ThinkingOption>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (models case Done(value: final list) when list.isNotEmpty) ...[
          if (list.any(isUsableModel))
            _modelField([...list.where(isUsableModel)]),
          ModelPickerExtras(
            backend: backend.id,
            capabilities: backend.capabilities,
            models: list,
          ),
        ],
        if (models != null && models is! Done)
          Text('Models: ${problemOf(models)}'),
        if (backend.capabilities.thinking && levels.isNotEmpty)
          _thinkingField(levels),
        if (modes case Done(value: final axes))
          for (final axis in axes) _modeField(axis),
      ],
    );
  }

  Widget _modelField(List<ModelSummary> models) =>
      DropdownButtonFormField<ModelSummary>(
        key: const ValueKey('new-session-model'),
        initialValue: choice.model,
        decoration: const InputDecoration(labelText: 'Model'),
        items: [
          for (final model in models)
            DropdownMenuItem(value: model, child: Text(model.displayName)),
        ],
        onChanged: (picked) => onChanged(
          SessionSettingsChoice(model: picked, modes: choice.modes),
        ),
      );

  Widget _thinkingField(List<ThinkingOption> levels) =>
      DropdownButtonFormField<String>(
        initialValue: choice.thinking,
        decoration: const InputDecoration(labelText: 'Thinking'),
        items: [
          for (final level in levels)
            DropdownMenuItem(
              value: level.value,
              child: Text(level.label ?? level.value),
            ),
        ],
        onChanged: (picked) => onChanged(
          SessionSettingsChoice(
            model: choice.model,
            thinking: picked,
            modes: choice.modes,
          ),
        ),
      );

  Widget _modeField(ModeAxis axis) => Padding(
    padding: Insets.topSm,
    child: DropdownButtonFormField<String>(
      initialValue: choice.modes[axis.id] ?? axis.defaultValue,
      decoration: InputDecoration(
        labelText: axis.label,
        helperText: axis.description,
      ),
      items: [
        for (final option in axis.options)
          DropdownMenuItem(value: option.value, child: Text(option.label)),
      ],
      onChanged: (picked) => onChanged(
        SessionSettingsChoice(
          model: choice.model,
          thinking: choice.thinking,
          modes: {...choice.modes, axis.id: ?picked},
        ),
      ),
    ),
  );
}
