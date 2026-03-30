import 'package:broski/models/claude_code.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_stat_badges.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Claude Code session card. Extracted from sessions_screen.dart.
class CCSessionCard extends ConsumerWidget {
  const CCSessionCard({
    super.key,
    required this.session,
    required this.onTap,
    required this.onDelete,
    this.onLongPress,
  });
  final ClaudeCodeSession session;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final VoidCallback? onLongPress;
  String _getProjectName() {
    final parts = session.cwd.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  String _formatDate(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
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
    final status = sessionStatuses[session.id];
    final isActive = status != null && (status.isBusy || status.isRetry);
    // Accent color for left bar
    final accentColor = isActive
        ? (status.isRetry ? ocTheme.warning : ocTheme.info)
        : ocTheme.accent.withValues(alpha: 0.4);
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
                            session.displayTitle,
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
                        if (session.isSubagentSession) ...[
                          const SizedBox(width: Spacing.xs),
                          Icon(
                            AppIcons.gitBranch,
                            size: 14,
                            color: ocTheme.info,
                          ),
                        ],
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
                            _formatDate(session.updatedAt),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    // Tag chip (if session has a tag)
                    if (session.tag != null && session.tag!.isNotEmpty) ...[
                      const SizedBox(height: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: ocTheme.accent.withValues(alpha: 0.12),
                          borderRadius: Radii.brXs,
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              AppIcons.star,
                              size: 10,
                              color: ocTheme.accent,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              session.tag!,
                              style: TextStyle(
                                color: ocTheme.accent,
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                    // First prompt preview (if available and different from title)
                    if (session.firstPrompt != null &&
                        session.firstPrompt!.isNotEmpty &&
                        session.firstPrompt != session.displayTitle) ...[
                      const SizedBox(height: 4),
                      Text(
                        session.firstPrompt!,
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 12.5,
                          height: 1.3,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    const SizedBox(height: 10),
                    // Meta row: agent icon + project + model badge
                    Row(
                      children: [
                        // Claude Code icon
                        Icon(
                          AppIcons.terminal,
                          size: 12,
                          color: ocTheme.accent,
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
                        // Model badge if available
                        if (session.model != null) ...[
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
                              session.model!.split('/').last,
                              style: TextStyle(
                                color: ocTheme.info,
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                        // Git branch if available
                        if (session.gitBranch != null) ...[
                          Text(
                            ' · ',
                            style: TextStyle(
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
                              fontSize: 12,
                            ),
                          ),
                          Flexible(
                            child: Text(
                              session.gitBranch!,
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
                        // Diff stats badges (or message count fallback)
                        if (session.summary != null &&
                            (session.summary!.additions > 0 ||
                                session.summary!.deletions > 0 ||
                                session.summary!.files > 0))
                          ...buildSessionStatBadges(session.summary, ocTheme)
                        else if (session.messageCount != null &&
                            session.messageCount! > 0)
                          Text(
                            '${session.messageCount} msgs',
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 11,
                            ),
                          ),
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
    return Dismissible(
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
        onDelete();
        return false; // Let parent handle actual deletion
      },
      child: card,
    );
  }
}
