import 'package:broski/agent/catalog/catalog_lists.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/pickers/mode_axis_section.dart';
import 'package:broski/screens/agent/pickers/model_picker_extras.dart';
import 'package:broski/screens/agent/pickers/model_picker_sheet.dart';
import 'package:broski/screens/agent/pickers/picker_field_row.dart';
import 'package:broski/screens/agent/pickers/picker_section.dart';
import 'package:broski/screens/agent/pickers/thinking_levels.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
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
    final capabilities = backend.capabilities;
    final levels = choice.model?.thinking.options ?? const <ThinkingOption>[];
    final listed = switch (models) {
      Done(value: final list) when list.isNotEmpty => list,
      _ => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (listed != null) _modelSection(context, listed),
        if (models != null && models is! Done) _ModelProblem(outcome: models),
        if (capabilities.thinking && levels.isNotEmpty)
          _thinkingSection(levels),
        if (modes case Done(value: final axes))
          for (final axis in axes) _modeSection(axis),
      ],
    );
  }

  Widget _modelSection(BuildContext context, List<ModelSummary> models) =>
      PickerSection(
        title: 'Model',
        children: [
          if (models.any(isUsableModel))
            PickerFieldRow(
              key: const ValueKey('new-session-model'),
              icon: AppIcons.memory,
              value: choice.model?.displayName ?? 'Backend default',
              onTap: () => showModelPicker(
                context,
                models: models,
                current: choice.model?.id,
                onPick: (model) => onChanged(
                  SessionSettingsChoice(model: model, modes: choice.modes),
                ),
              ),
            ),
          ModelPickerExtras(
            backend: backend.id,
            capabilities: backend.capabilities,
            models: models,
          ),
        ],
      );

  Widget _thinkingSection(List<ThinkingOption> levels) => PickerSection(
    title: 'Thinking',
    children: [
      ThinkingLevelPicker(
        options: levels,
        current: choice.thinking,
        onPick: (level) => onChanged(
          SessionSettingsChoice(
            model: choice.model,
            thinking: level,
            modes: choice.modes,
          ),
        ),
      ),
    ],
  );

  Widget _modeSection(ModeAxis axis) => ModeAxisSection(
    axis: axis,
    isChosen: (value) => value == (choice.modes[axis.id] ?? axis.defaultValue),
    onPick: (value) => onChanged(
      SessionSettingsChoice(
        model: choice.model,
        thinking: choice.thinking,
        modes: {...choice.modes, axis.id: value},
      ),
    ),
  );
}

class _ModelProblem extends StatelessWidget {
  const _ModelProblem({required this.outcome});

  final Outcome<List<ModelSummary>> outcome;

  @override
  Widget build(BuildContext context) => Text(
    'Models: ${problemOf(outcome)}',
    style: AppTypography.bodySmall(color: OpenCodeTheme.of(context).error),
  );
}
