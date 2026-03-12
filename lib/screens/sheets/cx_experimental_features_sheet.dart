import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/codex_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows Codex experimental features with their status.
void showCxExperimentalFeaturesSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'Experimental Features',
    initialSize: 0.5,
    child: const _CxExperimentalFeaturesContent(),
  );
}

class _CxExperimentalFeaturesContent extends ConsumerWidget {
  const _CxExperimentalFeaturesContent();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    // Reads from the reactive provider populated at bootstrap — no re-fetch.
    final features = ref.watch(cxExperimentalFeaturesProvider);

    if (features.isEmpty) {
      return Padding(
        padding: Insets.card,
        child: Center(
          child: Text(
            'No experimental features available.',
            style: AppTypography.bodySmall(color: theme.textMuted),
          ),
        ),
      );
    }
    return Padding(
      padding: Insets.screenH,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: theme.primary.withValues(alpha: 0.06),
              borderRadius: Radii.brSm,
              border: Border.all(
                color: theme.primary.withValues(alpha: 0.15),
              ),
            ),
            child: Row(
              children: [
                Icon(AppIcons.science, size: 16, color: theme.primary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Experimental features may change or break without notice.',
                    style: AppTypography.label(color: theme.primary),
                  ),
                ),
              ],
            ),
          ),
          ...features.map((f) {
            final name =
                f['name']?.toString() ?? f['id']?.toString() ?? 'Unknown';
            final description = f['description']?.toString() ?? '';
            final enabled = f['enabled'] == true;
            return Container(
              margin: const EdgeInsets.only(bottom: 6),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.bgRaised,
                borderRadius: Radii.brSm,
                border: Border.all(color: theme.border),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          name,
                          style: AppTypography.labelLarge(color: theme.text),
                        ),
                        if (description.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            description,
                            style:
                                AppTypography.label(color: theme.textMuted),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: enabled
                          ? theme.success.withValues(alpha: 0.15)
                          : theme.textMuted.withValues(alpha: 0.1),
                      borderRadius: Radii.brXs,
                    ),
                    child: Text(
                      enabled ? 'ON' : 'OFF',
                      style: TextStyle(
                        color: enabled ? theme.success : theme.textMuted,
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
