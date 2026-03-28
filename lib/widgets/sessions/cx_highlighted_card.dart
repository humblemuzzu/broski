import 'package:broski/models/codex.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_stat_badges.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Highlighted Codex thread card with accent styling.
/// Extracted from sessions_screen.dart.
class CodexHighlightedThreadCard extends ConsumerWidget {
  const CodexHighlightedThreadCard({
    super.key,
    required this.thread,
    required this.highlightColor,
    required this.onTap,
    this.onLongPress,
  });
  final CodexThread thread;
  final HighlightColor highlightColor;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  String _getProjectName() {
    final parts = thread.cwd.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inMinutes < 1) {
      return 'Just now';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m ago';
    } else if (diff.inHours < 24) {
      return '${diff.inHours}h ago';
    } else if (diff.inDays < 7) {
      return '${diff.inDays}d ago';
    } else {
      return '${date.day}/${date.month}/${date.year}';
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    final status = sessionStatuses[thread.id];
    final isActive = status != null && (status.isBusy || status.isRetry);
    final color = highlightColor.forBrightness(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    final bgColor = highlightColor.backgroundFor(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        decoration: BoxDecoration(color: bgColor, borderRadius: Radii.brMd),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar (highlight color)
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: color,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                ),
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title row with star + time/status
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Star icon inline
                        Icon(AppIcons.star, size: 16, color: color),
                        const SizedBox(width: Spacing.sm),
                        Expanded(
                          child: Text(
                            thread.displayTitle,
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              height: 1.3,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: Spacing.md),
                        // Status or time
                        if (isActive)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: 10,
                                height: 10,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    status.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                status.isRetry ? 'Retry' : 'Working',
                                style: TextStyle(
                                  color: status.isRetry
                                      ? ocTheme.warning
                                      : ocTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          )
                        else
                          Text(
                            _formatDate(thread.updatedAtDateTime),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Meta row: agent icon + project + model badge
                    Row(
                      children: [
                        // Codex icon
                        Icon(
                          AppIcons.autoAwesome,
                          size: 12,
                          color: ocTheme.primary,
                        ),
                        const SizedBox(width: 6),
                        // Project name
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        // Model provider badge
                        if (thread.modelProvider != null &&
                            thread.modelProvider!.isNotEmpty) ...[
                          const SizedBox(width: Spacing.sm),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.info.withValues(alpha: 0.12),
                              borderRadius: Radii.brXs,
                            ),
                            child: Text(
                              thread.modelProvider!,
                              style: TextStyle(
                                color: ocTheme.info,
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                        // Git branch if available
                        if (thread.gitBranch != null) ...[
                          Text(
                            ' · ',
                            style: TextStyle(
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
                              fontSize: 12,
                            ),
                          ),
                          Flexible(
                            child: Text(
                              thread.gitBranch!,
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 12,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        // Agent nickname
                        if (thread.agentNickname != null) ...[
                          const SizedBox(width: Spacing.sm),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.accent.withValues(alpha: 0.12),
                              borderRadius: Radii.brXs,
                            ),
                            child: Text(
                              thread.agentNickname!,
                              style: TextStyle(
                                color: ocTheme.accent,
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                        const Spacer(),
                        // Diff stats badges
                        ...buildSessionStatBadges(thread.summary, ocTheme),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
