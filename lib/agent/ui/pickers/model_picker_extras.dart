import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/panels/run_op.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Whether a model can be chosen now.
bool isUsableModel(ModelSummary model) => model.unavailableReason == null;

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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (unusable.isNotEmpty) _UnusableModels(models: unusable),
        for (final panel in panels)
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton(
              key: ValueKey('model-panel:${panel.kind.wire}'),
              onPressed: () => runOp(
                context,
                opToolsOf(ref),
                panel,
                sessionTarget(SessionRef(backend: backend, sessionId: '')),
              ),
              child: Text(panel.label),
            ),
          ),
      ],
    );
  }
}

class _UnusableModels extends StatelessWidget {
  const _UnusableModels({required this.models});

  final List<ModelSummary> models;

  @override
  Widget build(BuildContext context) {
    final byProvider = <String, List<ModelSummary>>{};
    for (final model in models) {
      byProvider.putIfAbsent(model.providerId ?? '', () => []).add(model);
    }
    return ExpansionTile(
      key: const ValueKey('unavailable-models'),
      tilePadding: EdgeInsets.zero,
      title: Text('Not available yet (${models.length})'),
      subtitle: Text(
        'Models the backend knows but cannot run here, and what each one '
        'needs.',
        style: AppTypography.caption(),
      ),
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
    final first = models.first;
    final shared = _sharedReason(models);
    return ExpansionTile(
      key: ValueKey('unavailable-provider:$provider'),
      tilePadding: const EdgeInsets.only(left: Spacing.md),
      title: Text(
        first.providerName ?? (provider.isEmpty ? 'Other' : provider),
      ),
      subtitle: shared == null
          ? null
          : Text(shared, style: AppTypography.caption()),
      trailing: Text('${models.length}'),
      children: [
        for (final model in models)
          ListTile(
            key: ValueKey('unavailable-model:${model.id}'),
            dense: true,
            enabled: false,
            contentPadding: const EdgeInsets.only(left: Spacing.xl),
            title: Text(model.displayName),
            subtitle: shared == null && model.unavailableReason != null
                ? Text(model.unavailableReason!)
                : null,
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
