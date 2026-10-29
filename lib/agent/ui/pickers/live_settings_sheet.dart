import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/catalog_lists.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/session/session_controls.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
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
      padding: Insets.screen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ModelSection(
            models: models,
            current: snapshot.modelId,
            timing: capabilities.modelSwitch,
            controls: controls,
          ),
          if (capabilities.thinking && levels.isNotEmpty)
            _ThinkingSection(
              levels: levels,
              current: snapshot.thinking,
              controls: controls,
            ),
          if (modes case Done(value: final axes))
            for (final axis in axes)
              _ModeSection(
                axis: axis,
                current: snapshot.modes,
                controls: controls,
              ),
        ],
      ),
    );
  }
}

class _ModelSection extends StatelessWidget {
  const _ModelSection({
    required this.models,
    required this.current,
    required this.timing,
    required this.controls,
  });

  final Outcome<List<ModelSummary>>? models;
  final ModelId? current;
  final ModelSwitchTiming timing;
  final SessionControls controls;

  @override
  Widget build(BuildContext context) {
    final listed = models;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Model', style: AppTypography.labelLarge()),
        Text(switch (timing) {
          ModelSwitchTiming.nextRequest => 'A change reaches the next request.',
          ModelSwitchTiming.nextRun => 'A change reaches the next run.',
        }, style: AppTypography.caption()),
        if (listed case Done(value: final list))
          Wrap(
            spacing: Spacing.sm,
            children: [
              for (final model in list)
                ChoiceChip(
                  key: ValueKey('model:${model.id}'),
                  label: Text(model.displayName),
                  selected: model.id == current,
                  onSelected: (_) => controls.setModel(model.id),
                ),
            ],
          )
        else if (listed != null)
          Text(problemOf(listed) ?? ''),
      ],
    );
  }
}

class _ThinkingSection extends StatelessWidget {
  const _ThinkingSection({
    required this.levels,
    required this.current,
    required this.controls,
  });

  final List<ThinkingOption> levels;
  final String? current;
  final SessionControls controls;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.topSm,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Thinking', style: AppTypography.labelLarge()),
        Wrap(
          spacing: Spacing.sm,
          children: [
            for (final level in levels)
              ChoiceChip(
                key: ValueKey('thinking:${level.value}'),
                label: Text(level.label ?? level.value),
                tooltip: level.description,
                selected: level.value == current,
                onSelected: (_) => controls.setThinking(level.value),
              ),
          ],
        ),
      ],
    ),
  );
}

class _ModeSection extends StatelessWidget {
  const _ModeSection({
    required this.axis,
    required this.current,
    required this.controls,
  });

  final ModeAxis axis;
  final List<ModeSetting> current;
  final SessionControls controls;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.topSm,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(axis.label, style: AppTypography.labelLarge()),
        for (final option in axis.options)
          ListTile(
            key: ValueKey('mode:${axis.id}:${option.value}'),
            dense: true,
            selected: current.any(
              (mode) => mode.axis == axis.id && mode.value == option.value,
            ),
            title: Text(option.label),
            subtitle: switch (option.description) {
              null => null,
              final description => Text(description),
            },
            onTap: () => controls.setMode(axis.id, option.value),
          ),
      ],
    ),
  );
}
