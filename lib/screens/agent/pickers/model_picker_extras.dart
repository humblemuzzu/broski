import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/panel_registry.dart';
import 'package:broski/screens/agent/panels/run_op.dart';
import 'package:broski/screens/agent/pickers/model_choice_row.dart';
import 'package:broski/screens/agent/pickers/picker_choice_row.dart';
import 'package:broski/screens/agent/pickers/picker_disclosure.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

export 'package:broski/screens/agent/pickers/model_choice_row.dart'
    show isUsableModel;

/// What goes beside a model choice: the models the backend knows but cannot
/// use now, each with what is missing and none of them selectable, and the
/// backend's own operations on its model lists (contract §13).
class ModelPickerExtras extends ConsumerWidget {
  const ModelPickerExtras({
    super.key,
    required this.backend,
    required this.capabilities,
    required this.models,
  });

  final BackendId backend;
  final Capabilities capabilities;
  final List<ModelSummary> models;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unusable = models.where((model) => !isUsableModel(model)).toList();
    final panels = panelsAt(capabilities, OpPlace.modelPicker);
    if (unusable.isEmpty && panels.isEmpty) return const SizedBox.shrink();
    final tools = opToolsOf(ref);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (unusable.isNotEmpty) _UnavailableModels(models: unusable),
        for (final panel in panels)
          _PanelAction(panel: panel, backend: backend, tools: tools),
      ],
    );
  }
}

class _PanelAction extends StatelessWidget {
  const _PanelAction({
    required this.panel,
    required this.backend,
    required this.tools,
  });

  final OpPanel panel;
  final BackendId backend;
  final OpTools tools;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: TextButton.icon(
        key: ValueKey('model-panel:${panel.kind.wire}'),
        onPressed: () => runOp(
          context,
          tools,
          panel,
          sessionTarget(SessionRef(backend: backend, sessionId: '')),
        ),
        icon: const Icon(AppIcons.refresh, size: 16),
        label: Text(panel.label),
        style: TextButton.styleFrom(
          foregroundColor: theme.accent,
          padding: Insets.chipH,
          textStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
        ),
      ),
    );
  }
}

class _UnavailableModels extends StatelessWidget {
  const _UnavailableModels({required this.models});

  final List<ModelSummary> models;

  @override
  Widget build(BuildContext context) {
    final byProvider = <String, List<ModelSummary>>{};
    for (final model in models) {
      byProvider.putIfAbsent(model.providerId ?? '', () => []).add(model);
    }
    return PickerDisclosure(
      key: const ValueKey('unavailable-models'),
      title: 'Not available yet (${models.length})',
      subtitle:
          'Models the backend knows but cannot run here, and what each one '
          'needs.',
      children: [
        for (final MapEntry(key: provider, value: group) in byProvider.entries)
          _ProviderGroup(provider: provider, models: group),
      ],
    );
  }
}

class _ProviderGroup extends StatelessWidget {
  const _ProviderGroup({required this.provider, required this.models});

  final String provider;
  final List<ModelSummary> models;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final shared = _sharedReason(models);
    return PickerDisclosure(
      key: ValueKey('unavailable-provider:$provider'),
      title:
          models.first.providerName ?? (provider.isEmpty ? 'Other' : provider),
      subtitle: shared,
      trailing: Text(
        '${models.length}',
        style: AppTypography.label(color: theme.textMuted),
      ),
      children: [
        for (final model in models)
          PickerChoiceRow(
            key: ValueKey('unavailable-model:${model.id}'),
            label: model.displayName,
            detail: shared == null ? model.unavailableReason : null,
            selected: false,
            enabled: false,
          ),
      ],
    );
  }

  /// The reason every model of the group gives, said once for all of them;
  /// null when they differ, and each says its own.
  static String? _sharedReason(List<ModelSummary> models) {
    final reasons = {for (final model in models) model.unavailableReason};
    return reasons.length == 1 ? reasons.single : null;
  }
}
