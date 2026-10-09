import 'package:broski/models/pi.dart';
import 'package:broski/models/runtime/runtime_model_summary.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_durable/pi_durable_providers.dart';
import 'package:broski/screens/chat/pi_durable_thinking.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Model + thinking level for the open durable session. Both go over one
/// `unified_set_model`, which is why they share a sheet.
Future<void> showPiDurableModelSheet({
  required BuildContext context,
  required WidgetRef ref,
}) {
  return DetailSheet.show(
    context: context,
    title: 'Model',
    initialSize: 0.6,
    maxSize: 0.9,
    child: const _PiDurableModelSheet(),
  );
}

class _PiDurableModelSheet extends ConsumerStatefulWidget {
  const _PiDurableModelSheet();

  @override
  ConsumerState<_PiDurableModelSheet> createState() =>
      _PiDurableModelSheetState();
}

class _PiDurableModelSheetState extends ConsumerState<_PiDurableModelSheet> {
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final chatState = ref.watch(chatSessionProvider);
    final models = ref.watch(piDurableModelsProvider);
    final thinkingLevel = chatState.pdThinkingLevel ?? PiThinkingLevel.medium;
    final currentModel = chatState.pdModel;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Thinking level',
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: Spacing.sm),
          Wrap(
            spacing: Spacing.sm,
            runSpacing: Spacing.sm,
            children: [
              for (final level in PiThinkingLevel.values)
                _LevelChip(
                  label: level.displayName,
                  selected: level == thinkingLevel,
                  onTap: _busy
                      ? null
                      : () => _apply(model: currentModel, thinkingLevel: level),
                ),
            ],
          ),
          const SizedBox(height: Spacing.xl),
          Text(
            'Model',
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: Spacing.sm),
          models.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (error, _) => Text(
              'Could not load models: $error',
              style: TextStyle(color: theme.error, fontSize: 13),
            ),
            data: (list) => Column(
              children: [
                for (final model in list)
                  _ModelTile(
                    model: model,
                    selected: piDurableModelRef(model) == currentModel,
                    onTap: _busy
                        ? null
                        : () => _apply(
                            model: piDurableModelRef(model),
                            thinkingLevel: thinkingLevel,
                          ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _apply({
    required String? model,
    required PiThinkingLevel thinkingLevel,
  }) async {
    setState(() => _busy = true);
    final ok = await applyPiDurableModelChange(
      ref: ref,
      model: model,
      thinkingLevel: thinkingLevel,
    );
    if (!mounted) return;
    setState(() => _busy = false);
    if (ok) Navigator.of(context).pop();
  }
}

class _LevelChip extends StatelessWidget {
  const _LevelChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: Insets.chip,
        decoration: BoxDecoration(
          color: selected
              ? theme.primary.withValues(alpha: 0.15)
              : theme.backgroundElement,
          borderRadius: Radii.brSm,
          border: Border.all(
            color: selected ? theme.primary : theme.borderSubtle,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: selected ? theme.primary : theme.text,
            fontSize: 13,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

class _ModelTile extends StatelessWidget {
  const _ModelTile({
    required this.model,
    required this.selected,
    required this.onTap,
  });

  final RuntimeModelSummary model;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brSm,
      child: Padding(
        padding: Insets.listItemDense,
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    model.label.isEmpty ? model.id : model.label,
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (model.contextWindow != null)
                    Text(
                      '${model.contextWindow} context',
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    ),
                ],
              ),
            ),
            if (selected) Icon(AppIcons.check, size: 18, color: theme.primary),
          ],
        ),
      ),
    );
  }
}
