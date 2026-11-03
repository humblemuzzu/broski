import 'package:broski/agent/agent_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// How long ago [savedAt] (milliseconds since the epoch) was, as a person
/// says it.
String savedAgo(DateTime now, int savedAt) {
  final ago = now.difference(DateTime.fromMillisecondsSinceEpoch(savedAt));
  if (ago.inMinutes < 1) return 'just now';
  if (ago.inHours < 1) return '${ago.inMinutes} min ago';
  if (ago.inDays < 1) return '${ago.inHours} h ago';
  return '${ago.inDays} d ago';
}

/// Says that what is shown is the last the phone saw, read-only until the
/// link is back. [savedAt] is when that copy was taken, if it is a saved
/// copy rather than a list or conversation read before the link dropped.
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key, this.savedAt});

  final int? savedAt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final saved = savedAt;
    final text = saved == null
        ? 'Offline \u00b7 read-only'
        : 'Offline \u00b7 read-only \u00b7 saved '
              '${savedAgo(ref.watch(agentClockProvider).now(), saved)}';
    return Semantics(
      liveRegion: true,
      child: Container(
        key: const ValueKey('offline-banner'),
        width: double.infinity,
        padding: Insets.cardSm,
        color: theme.warning.withValues(alpha: 0.1),
        child: Row(
          children: [
            Icon(AppIcons.wifiOff, size: 16, color: theme.warning),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(
                text,
                style: AppTypography.bodySmall(color: theme.warning),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
