import 'package:broski/models/session.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Card for child (background task) sessions - clean compact design.
/// Extracted from sessions_screen.dart.
class ChildSessionCard extends StatelessWidget {
  const ChildSessionCard({
    super.key,
    required this.session,
    required this.onTap,
    this.status,
    this.isOfflineMode = false,
  });
  final SessionSummary session;
  final SessionStatus? status;
  final VoidCallback onTap;
  final bool isOfflineMode;
  bool get isActive => status?.isBusy == true || status?.isRetry == true;
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

  /// Extract agent name from title like "Description (@agent subagent)"
  String? _extractAgentName() {
    final match = RegExp(r'\(@(\w+) subagent\)$').firstMatch(session.title);
    return match?.group(1);
  }

  /// Get title without the agent suffix
  String _getCleanTitle() {
    return session.title.replaceAll(RegExp(r'\s*\(@\w+ subagent\)$'), '');
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final agentName = _extractAgentName();
    final cleanTitle = _getCleanTitle();
    final stats = session.summary;
    final hasStats =
        stats != null &&
        (stats.additions > 0 || stats.deletions > 0 || stats.files > 0);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: ocTheme.backgroundElement.withValues(alpha: 0.4),
          borderRadius: Radii.brSm,
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar (info color for tasks)
            Container(
              width: 2,
              decoration: BoxDecoration(
                color: isActive
                    ? ocTheme.info
                    : ocTheme.info.withValues(alpha: 0.4),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(8),
                  bottomLeft: Radius.circular(8),
                ),
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
                child: Row(
                  children: [
                    // Content
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Title with optional agent badge
                          Row(
                            children: [
                              if (agentName != null) ...[
                                Text(
                                  '@$agentName',
                                  style: TextStyle(
                                    color: ocTheme.info,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(width: 6),
                              ],
                              Expanded(
                                child: Text(
                                  cleanTitle,
                                  style: TextStyle(
                                    color: ocTheme.text.withValues(alpha: 0.85),
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: Spacing.xs),
                          // Stats + time row
                          Row(
                            children: [
                              Text(
                                _formatDate(session.time.updated),
                                style: TextStyle(
                                  color: ocTheme.textMuted,
                                  fontSize: 11,
                                ),
                              ),
                              if (hasStats) ...[
                                Text(
                                  ' · ',
                                  style: TextStyle(
                                    color: ocTheme.textMuted.withValues(
                                      alpha: 0.5,
                                    ),
                                    fontSize: 11,
                                  ),
                                ),
                                if (stats.additions > 0)
                                  Text(
                                    '+${stats.additions}',
                                    style: TextStyle(
                                      color: ocTheme.diffAdded,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                if (stats.additions > 0 && stats.deletions > 0)
                                  Text(
                                    ' ',
                                    style: TextStyle(
                                      color: ocTheme.textMuted,
                                      fontSize: 11,
                                    ),
                                  ),
                                if (stats.deletions > 0)
                                  Text(
                                    '-${stats.deletions}',
                                    style: TextStyle(
                                      color: ocTheme.diffRemoved,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                              ],
                            ],
                          ),
                        ],
                      ),
                    ),
                    // Status indicator
                    if (isActive)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(
                            strokeWidth: 1.5,
                            valueColor: AlwaysStoppedAnimation<Color>(
                              (status?.isRetry == true)
                                  ? ocTheme.warning
                                  : ocTheme.info,
                            ),
                          ),
                        ),
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
