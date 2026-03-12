import 'package:flutter/material.dart';
import '../../theme/app_typography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/chat_provider.dart';
import '../../providers/codex_provider.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import '../../utils/error_utils.dart';

/// Bottom sheet that shows available Codex models via a cache-first provider.
///
/// First open with no cache: brief loading spinner, then list.
/// Subsequent opens: instant from cache, background refresh picks up new models.
class CxModelSheet extends ConsumerWidget {
  const CxModelSheet({super.key});
  static void show(BuildContext context) {
    DetailSheet.show(
      context: context,
      title: 'Codex Model',
      initialSize: 0.5,
      child: const CxModelSheet(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final modelsAsync = ref.watch(codexModelsProvider);
    final chatState = ref.watch(chatSessionProvider);
    final current = chatState.cxModel ?? '';
    final isUsingDefault = current.isEmpty;
    return modelsAsync.when(
      data: (models) {
        final visibleModels = models.where((m) => !m.hidden).toList();
        if (visibleModels.isEmpty) {
          return Padding(
            padding: Insets.card,
            child: Center(
              child: Text(
                'No models available',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
            ),
          );
        }
        return Padding(
          padding: Insets.screenH,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Select the model used for Codex turns.',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
              const SizedBox(height: 14),
              ...visibleModels.map((model) {
                final selected = isUsingDefault
                    ? model.isDefault
                    : (current == model.id || current == model.model);
                return ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(
                    selected ? AppIcons.radioChecked : AppIcons.radioUnchecked,
                    size: 18,
                    color: selected ? theme.primary : theme.textMuted,
                  ),
                  title: Row(
                    children: [
                      Flexible(
                        child: Text(
                          model.displayName,
                          style: AppTypography.bodySmall(color: theme.text),
                        ),
                      ),
                      if (model.isDefault) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: theme.primary.withValues(alpha: 0.15),
                            borderRadius: Radii.brXs,
                          ),
                          child: Text(
                            'default',
                            style: TextStyle(
                              color: theme.primary,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                      if (model.supportsImages) ...[
                        const SizedBox(width: 4),
                        Icon(
                          Icons.camera_alt_outlined,
                          size: 14,
                          color: theme.textMuted,
                        ),
                      ],
                    ],
                  ),
                  subtitle: model.description.isNotEmpty
                      ? Text(
                          model.description,
                          style: AppTypography.label(color: theme.textMuted),
                        )
                      : null,
                  onTap: () {
                    ref
                        .read(chatSessionProvider.notifier)
                        .setCodexModel(model.id);
                    Navigator.pop(context);
                  },
                );
              }),
              // Show upgrade banner if any model has an upgrade path
              ...(() {
                final modelsWithUpgrade = visibleModels
                    .where((m) => m.hasUpgrade)
                    .toList();
                if (modelsWithUpgrade.isEmpty) return <Widget>[];
                final first = modelsWithUpgrade.first;
                return <Widget>[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: theme.primary.withValues(alpha: 0.08),
                      borderRadius: Radii.brSm,
                      border: Border.all(
                        color: theme.primary.withValues(alpha: 0.2),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.upgrade, size: 18, color: theme.primary),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            first.upgradeCopy ?? 'A model upgrade is available',
                            style: AppTypography.bodySmall(color: theme.text),
                          ),
                        ),
                      ],
                    ),
                  ),
                ];
              })(),
            ],
          ),
        );
      },
      loading: () => const Padding(
        padding: Insets.xxxl,
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => Padding(
        padding: Insets.card,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.error, color: theme.error, size: 32),
            SizedBox(height: Spacing.sm),
            Text(
              'Failed to load models',
              style: AppTypography.labelLarge(color: theme.text),
            ),
            SizedBox(height: Spacing.xs),
            Text(
              humanizeError(e),
              style: AppTypography.label(color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
            SizedBox(height: Spacing.md),
            TextButton(
              onPressed: () => ref.read(codexModelsProvider.notifier).refresh(),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
