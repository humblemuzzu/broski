import 'package:broski/models/pi.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_stat_badges.dart';
import 'package:flutter/material.dart';

/// Pi session card. Extracted from sessions_screen.dart.
class PiSessionCard extends StatelessWidget {
  const PiSessionCard({
    super.key,
    required this.title,
    required this.session,
    required this.isHighlighted,
    required this.onTap,
    this.onLongPress,
    this.onDelete,
  });

  final String title;
  final PiSessionInfo session;
  final bool isHighlighted;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final VoidCallback? onDelete;

  String _getProjectName() {
    final parts = session.cwd.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${date.day}/${date.month}/${date.year}';
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
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
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: ocTheme.primary.withValues(alpha: 0.4),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            title,
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
                        Text(
                          _formatDate(session.modified),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Icon(
                          AppIcons.autoAwesome,
                          size: 12,
                          color: ocTheme.primary,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        if (session.parentSessionPath != null) ...[
                          const SizedBox(width: 6),
                          Icon(
                            AppIcons.forkRight,
                            size: 12,
                            color: ocTheme.info,
                          ),
                        ],
                        const Spacer(),
                        // Diff stats badges
                        ...buildSessionStatBadges(session.summary, ocTheme),
                        // Message count badge (if no diff stats)
                        if (session.summary == null ||
                            (session.summary!.additions == 0 &&
                                session.summary!.deletions == 0))
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
                              '${session.messageCount} msgs',
                              style: TextStyle(
                                color: ocTheme.info,
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
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
    if (onDelete != null) {
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
          onDelete!();
          return false;
        },
        child: card,
      );
    }
    return card;
  }
}
