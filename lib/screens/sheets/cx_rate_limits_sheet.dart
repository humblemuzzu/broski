import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../providers/service_providers.dart';
import '../../utils/error_utils.dart';

/// Shows Codex account rate limits.
void showCxRateLimitsSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'Rate Limits',
    initialSize: 0.45,
    child: const _CxRateLimitsContent(),
  );
}

final _cxRateLimitsProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.cxReadRateLimits();
});

class _CxRateLimitsContent extends ConsumerWidget {
  const _CxRateLimitsContent();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final limitsAsync = ref.watch(_cxRateLimitsProvider);

    return limitsAsync.when(
      data: (data) {
        if (data.isEmpty) {
          return Padding(
            padding: Insets.card,
            child: Center(
              child: Text(
                'No rate limit information available.',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
            ),
          );
        }
        final limits = data['limits'] as List<dynamic>? ?? [];
        final planType = data['planType']?.toString() ?? '';
        final resetsAt = data['resetsAt']?.toString() ?? '';

        return Padding(
          padding: Insets.screenH,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (planType.isNotEmpty) ...[
                Row(
                  children: [
                    Icon(AppIcons.subscription, size: 14, color: theme.primary),
                    const SizedBox(width: 6),
                    Text(
                      'Plan: $planType',
                      style: AppTypography.labelLarge(color: theme.text),
                    ),
                  ],
                ),
                SizedBox(height: Spacing.md),
              ],
              if (limits.isNotEmpty)
                ...limits.map((limit) {
                  if (limit is! Map) return const SizedBox.shrink();
                  final name =
                      limit['name']?.toString() ??
                      limit['type']?.toString() ??
                      'Unknown';
                  final used = (limit['used'] as num?)?.toDouble() ?? 0;
                  final max =
                      (limit['limit'] as num?)?.toDouble() ??
                      (limit['max'] as num?)?.toDouble() ??
                      1;
                  final ratio = max > 0 ? (used / max).clamp(0.0, 1.0) : 0.0;
                  final usedStr = _formatNumber(used);
                  final maxStr = _formatNumber(max);
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              name,
                              style: AppTypography.labelLarge(
                                color: theme.text,
                              ),
                            ),
                            Text(
                              '$usedStr / $maxStr',
                              style: AppTypography.label(
                                color: theme.textMuted,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        ClipRRect(
                          borderRadius: Radii.brXs,
                          child: LinearProgressIndicator(
                            value: ratio,
                            minHeight: 6,
                            backgroundColor: theme.border,
                            color: ratio > 0.9
                                ? theme.error
                                : ratio > 0.7
                                ? Colors.orange
                                : theme.primary,
                          ),
                        ),
                      ],
                    ),
                  );
                })
              else ...[
                // Fallback: render raw data as key-value pairs
                ...data.entries
                    .where((e) => e.key != 'limits')
                    .map(
                      (e) => Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              e.key,
                              style: AppTypography.label(
                                color: theme.textMuted,
                              ),
                            ),
                            Flexible(
                              child: Text(
                                '${e.value}',
                                style: AppTypography.labelLarge(
                                  color: theme.text,
                                ),
                                textAlign: TextAlign.end,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
              ],
              if (resetsAt.isNotEmpty) ...[
                SizedBox(height: Spacing.sm),
                Row(
                  children: [
                    Icon(AppIcons.timer, size: 13, color: theme.textMuted),
                    const SizedBox(width: 4),
                    Text(
                      'Resets: $resetsAt',
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                  ],
                ),
              ],
              SizedBox(height: Spacing.md),
              Center(
                child: TextButton.icon(
                  onPressed: () => ref.invalidate(_cxRateLimitsProvider),
                  icon: Icon(AppIcons.refresh, size: 14, color: theme.primary),
                  label: Text(
                    'Refresh',
                    style: AppTypography.label(color: theme.primary),
                  ),
                ),
              ),
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
        child: Center(
          child: Text(
            'Failed to load: ${humanizeError(e)}',
            style: AppTypography.bodySmall(color: theme.error),
          ),
        ),
      ),
    );
  }

  String _formatNumber(double n) {
    if (n >= 1000000) return '${(n / 1000000).toStringAsFixed(1)}M';
    if (n >= 1000) return '${(n / 1000).toStringAsFixed(0)}K';
    return n.toStringAsFixed(0);
  }
}
