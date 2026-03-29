import 'package:broski/providers/codex/cx_rate_limits_provider.dart';
import 'package:broski/screens/sheets/cx_rate_limits_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/glass_pill.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Compact rate-limit badge for the Codex floating header.
///
/// Shows the most constrained model's usage as a ratio (e.g. "150/200").
/// Color-coded: green < 70%, orange 70–90%, red > 90%.
/// Hidden when no data or no model exceeds 50% usage.
/// Taps open the full rate limits sheet.
class CxRateLimitBadge extends ConsumerWidget {
  const CxRateLimitBadge({super.key, this.data});

  /// If non-null, uses this data directly instead of watching the provider.
  final Map<String, dynamic>? data;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final raw = data ?? ref.watch(cxLiveRateLimitsProvider);
    if (raw == null) return const SizedBox.shrink();

    final limits = raw['limits'] as List<dynamic>? ?? [];
    if (limits.isEmpty) return const SizedBox.shrink();

    // Find the most constrained limit (highest usage ratio).
    double worstRatio = 0;
    int worstUsed = 0;
    int worstLimit = 0;

    for (final entry in limits) {
      if (entry is! Map) continue;
      final used = (entry['used'] as num?)?.toInt() ?? 0;
      final max = (entry['limit'] as num?)?.toInt() ?? 1;
      if (max <= 0) continue;
      final ratio = used / max;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstUsed = used;
        worstLimit = max;
      }
    }

    // Only show when at least one model exceeds 50% usage.
    if (worstRatio < 0.5) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final color = worstRatio > 0.9
        ? theme.error
        : worstRatio > 0.7
        ? theme.warning
        : theme.info;

    return GlassPill(
      onTap: () => showCxRateLimitsSheet(context),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(AppIcons.speed, size: 12, color: color),
          const SizedBox(width: 4),
          Text(
            '$worstUsed/$worstLimit',
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
