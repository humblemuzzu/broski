import 'package:flutter/material.dart';

import '../../models/highlight_color.dart';
import '../../models/session.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'session_stat_badges.dart';

/// Highlighted session card with accent styling (OpenCode).
/// Extracted from sessions_screen.dart.
class HighlightedSessionCard extends StatelessWidget {
  const HighlightedSessionCard({
    super.key,
    required this.session,
    required this.highlightColor,
    required this.onTap,
    this.status,
    this.isOfflineMode = false,
    this.onLongPress,
    this.onDelete,
  });
  final SessionSummary session;
  final SessionStatus? status;
  final HighlightColor highlightColor;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final VoidCallback? onDelete;
  final bool isOfflineMode;
  bool get isActive => status?.isBusy == true || status?.isRetry == true;
  String _getProjectName() {
    return session.directory.split('/').where((item) => item.isNotEmpty).last;
  }

  String _formatDate(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp * 1000);
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

  /// Get last activity from session diffs
  String? _getLastActivity() {
    final diffs = session.summary?.diffs;
    if (diffs == null || diffs.isEmpty) return null;
    final lastDiff = diffs.last;
    final fileName = lastDiff.file.split('/').last;
    return fileName;
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final color = highlightColor.forBrightness(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    final bgColor = highlightColor.backgroundFor(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    final stats = session.summary;
    final hasStats =
        stats != null &&
        (stats.additions > 0 || stats.deletions > 0 || stats.files > 0);
    final lastActivity = _getLastActivity();
    Widget card = GestureDetector(
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
                        SizedBox(width: Spacing.sm),
                        Expanded(
                          child: Text(
                            session.title,
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
                        SizedBox(width: Spacing.md),
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
                                    (status?.isRetry == true)
                                        ? ocTheme.warning
                                        : ocTheme.info,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                (status?.isRetry == true) ? 'Retry' : 'Working',
                                style: TextStyle(
                                  color: (status?.isRetry == true)
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
                            _formatDate(session.time.updated),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Meta row: project + stats
                    Row(
                      children: [
                        // Project name
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        // Last edited file
                        if (lastActivity != null) ...[
                          Text(
                            ' · ',
                            style: TextStyle(
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
                              fontSize: 12,
                            ),
                          ),
                          Flexible(
                            child: Text(
                              lastActivity,
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 12,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        const Spacer(),
                        // Stats badges
                        if (hasStats) ...[
                          if (stats.additions > 0)
                            StatBadge(
                              text: '+${stats.additions}',
                              color: ocTheme.diffAdded,
                            ),
                          if (stats.deletions > 0) ...[
                            const SizedBox(width: 6),
                            StatBadge(
                              text: '-${stats.deletions}',
                              color: ocTheme.diffRemoved,
                            ),
                          ],
                          if (stats.files > 0) ...[
                            const SizedBox(width: 6),
                            Text(
                              '${stats.files} ${stats.files == 1 ? 'file' : 'files'}',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ],
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
    // Swipe to delete
    if (onDelete != null) {
      card = Dismissible(
        key: Key(session.id),
        direction: DismissDirection.endToStart,
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          decoration: BoxDecoration(
            color: ocTheme.error,
            borderRadius: Radii.brMd,
          ),
          child: Icon(
            AppIcons.delete,
            color: ocTheme.selectedListItemText,
            size: 24,
          ),
        ),
        confirmDismiss: (_) async {
          onDelete!();
          return false;
        },
        child: card,
      );
    }
    return card;
  }
}
