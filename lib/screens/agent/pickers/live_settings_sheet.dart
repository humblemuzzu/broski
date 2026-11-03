import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/catalog_lists.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/session/session_controls.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/pickers/mode_axis_section.dart';
import 'package:broski/screens/agent/pickers/model_choice_list.dart';
import 'package:broski/screens/agent/pickers/model_picker_extras.dart';
import 'package:broski/screens/agent/pickers/picker_section.dart';
import 'package:broski/screens/agent/pickers/thinking_levels.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The model, thinking level and modes of a live session, each changed by
/// the request that sets it; the session's own events show the change
/// (contract §11.3, §11.5).
void showLiveSettings(
  BuildContext context,
  SessionRef session,
  Capabilities capabilities,
) => DetailSheet.show<void>(
  context: context,
  title: 'Model and modes',
  initialSize: 0.7,
  child: _LiveSettings(session: session, capabilities: capabilities),
);

const _sheetPadding = EdgeInsets.fromLTRB(
  Spacing.lg,
  Spacing.xs,
  Spacing.lg,
  Spacing.xxl,
);

class _LiveSettings extends ConsumerWidget {
  const _LiveSettings({required this.session, required this.capabilities});

  final SessionRef session;
  final Capabilities capabilities;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(sessionProvider(session));
    final controls = ref.read(sessionProvider(session).notifier).controls;
    final key = (backend: session.backend, cwd: state.summary?.cwd);
    final models = ref.watch(modelsProvider(key)).valueOrNull;
    final modes = ref.watch(modesProvider(key)).valueOrNull;
    final snapshot = state.snapshot;
    final current = switch (models) {
      Done(value: final list) =>
        list.where((model) => model.id == snapshot.modelId).firstOrNull,
      _ => null,
    };
    final levels = current?.thinking.options ?? const <ThinkingOption>[];
    return Padding(
      padding: _sheetPadding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ModelSection(
            models: models,
            current: snapshot.modelId,
            capabilities: capabilities,
            backend: session.backend,
            controls: controls,
          ),
          if (capabilities.thinking && levels.isNotEmpty)
            _ThinkingSection(
              levels: levels,
              current: snapshot.thinking,
              onPick: controls.setThinking,
            ),
          if (modes case Done(value: final axes))
            for (final axis in axes)
              ModeAxisSection(
                axis: axis,
                isChosen: (value) => snapshot.modes.any(
                  (mode) => mode.axis == axis.id && mode.value == value,
                ),
                onPick: (value) => controls.setMode(axis.id, value),
              ),
        ],
      ),
    );
  }
}

class _ThinkingSection extends StatelessWidget {
  const _ThinkingSection({
    required this.levels,
    required this.current,
    required this.onPick,
  });

  final List<ThinkingOption> levels;
  final String? current;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) => PickerSection(
    title: 'Thinking',
    children: [
      ThinkingLevelPicker(options: levels, current: current, onPick: onPick),
    ],
  );
}

class _ModelSection extends StatelessWidget {
  const _ModelSection({
    required this.models,
    required this.current,
    required this.capabilities,
    required this.backend,
    required this.controls,
  });

  final Outcome<List<ModelSummary>>? models;
  final ModelId? current;
  final Capabilities capabilities;
  final BackendId backend;
  final SessionControls controls;

  @override
  Widget build(BuildContext context) {
    final listed = models;
    return PickerSection(
      title: 'Model',
      caption: switch (capabilities.modelSwitch) {
        ModelSwitchTiming.nextRequest => 'A change reaches the next request.',
        ModelSwitchTiming.nextRun => 'A change reaches the next run.',
      },
      children: [
        if (listed case Done(value: final list)) ...[
          ModelChoiceList(
            models: list,
            current: current,
            onPick: (model) => controls.setModel(model.id),
          ),
          ModelPickerExtras(
            backend: backend,
            capabilities: capabilities,
            models: list,
          ),
        ] else if (listed != null)
          _Problem(outcome: listed),
      ],
    );
  }
}

class _Problem extends StatelessWidget {
  const _Problem({required this.outcome});

  final Outcome<List<ModelSummary>> outcome;

  @override
  Widget build(BuildContext context) => Text(
    problemOf(outcome) ?? '',
    style: AppTypography.bodySmall(color: OpenCodeTheme.of(context).error),
  );
}
