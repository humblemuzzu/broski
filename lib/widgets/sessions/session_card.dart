import 'package:flutter/material.dart';

import '../../models/session.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'session_stat_badges.dart';

// Session card with clean, minimal modern design.
// Extracted from sessions_screen.dart.
class SessionCard extends StatelessWidget {
  const SessionCard({
    super.key,
    required this.session,
    required this.onTap,
    this.status,
    this.onDelete,
    this.onLongPress,
    this.isOfflineMode = false,
    this.childCount = 0,
    this.isExpanded = false,
    this.onToggleExpand,
    this.activeChildCount = 0,
  });
  final SessionSummary session;
  final SessionStatus? status;
  final VoidCallback onTap;
  final VoidCallback? onDelete;
  final VoidCallback? onLongPress;
  final bool isOfflineMode;

  /// Number of background task children
  final int childCount;

  /// Whether children are expanded
  final bool isExpanded;

  /// Callback to toggle expand/collapse
  final VoidCallback? onToggleExpand;

  /// Number of active (busy/retry) child sessions
  final int activeChildCount;
  bool get isActive => status?.isBusy == true || status?.isRetry == true;
  bool get hasChildren => childCount > 0;
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
    final stats = session.summary;
    final hasStats =
        stats != null &&
        (stats.additions > 0 || stats.deletions > 0 || stats.files > 0);
    final lastActivity = _getLastActivity();
    // Accent color for left bar
    final accentColor = isActive
        ? ((status?.isRetry == true) ? ocTheme.warning : ocTheme.info)
        : ocTheme.primary.withValues(alpha: 0.4);
    Widget card = GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brMd,
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: accentColor,
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
                    // Title row with time/status
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
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
                        // Forked indicator
                        if (session.isForkedSession) ...[
                          SizedBox(width: Spacing.sm),
                          Icon(
                            AppIcons.forkRight,
                            size: 12,
                            color: ocTheme.accent,
                          ),
                        ],
                        // Last edited file
                        if (lastActivity != null) ...[
                          Text(
                            ' \u00b7 ',
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
                              '${stats.files} ${stats.files == 1 ? "file" : "files"}',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ],
                      ],
                    ),
                    // Background tasks row
                    if (hasChildren) ...[
                      const SizedBox(height: 10),
                      GestureDetector(
                        onTap: onToggleExpand,
                        behavior: HitTestBehavior.opaque,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              AppIcons.gitBranch,
                              size: 12,
                              color: activeChildCount > 0
                                  ? ocTheme.info
                                  : ocTheme.textMuted,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              '$childCount ${childCount == 1 ? "task" : "tasks"}',
                              style: TextStyle(
                                color: activeChildCount > 0
                                    ? ocTheme.info
                                    : ocTheme.textMuted,
                                fontSize: 11,
                              ),
                            ),
                            if (activeChildCount > 0) ...[
                              Text(
                                ' \u00b7 $activeChildCount active',
                                style: TextStyle(
                                  color: ocTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                            SizedBox(width: Spacing.xs),
                            AnimatedRotation(
                              turns: isExpanded ? 0.25 : 0,
                              duration: const Duration(milliseconds: 200),
                              child: Icon(
                                AppIcons.chevronRight,
                                color: activeChildCount > 0
                                    ? ocTheme.info
                                    : ocTheme.textMuted,
                                size: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
    // Wrap with Dismissible for swipe-to-delete (only when online)
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
          return false; // Let the parent handle actual deletion
        },
        child: card,
      );
    }
    return card;
  }
}
