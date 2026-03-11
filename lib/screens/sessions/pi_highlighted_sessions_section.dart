import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/highlight_color.dart';
import '../../models/pi.dart';
import '../../models/session.dart';
import '../../providers/sessions_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

/// Highlighted/starred Pi sessions section. Extracted from sessions_screen.dart.
/// Matches _CCHighlightedSessionsSection pattern exactly.
class PiHighlightedSessionsSection extends StatelessWidget {
  const PiHighlightedSessionsSection({
    super.key,
    required this.sessions,
    required this.highlightColor,
    required this.onTap,
    required this.onLongPress,
    required this.onDelete,
  });

  final List<PiSessionInfo> sessions;
  final HighlightColor highlightColor;
  final void Function(PiSessionInfo) onTap;
  final void Function(PiSessionInfo) onLongPress;
  final void Function(PiSessionInfo) onDelete;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final color = highlightColor.forBrightness(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section header
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
            child: Row(
              children: [
                Icon(AppIcons.star, size: 14, color: color),
                const SizedBox(width: 6),
                Text(
                  'HIGHLIGHTED',
                  style: TextStyle(
                    color: color,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                  ),
                ),
              ],
            ),
          ),
          // Highlighted session cards
          ...sessions.map((session) {
            return Padding(
              padding: Insets.bottomMd,
              child: _PiHighlightedSessionCard(
                session: session,
                highlightColor: highlightColor,
                onTap: () => onTap(session),
                onLongPress: () => onLongPress(session),
                onDelete: () => onDelete(session),
              ),
            );
          }),
        ],
      ),
    );
  }
}

/// Highlighted Pi session card with accent styling.
/// Matches _CCHighlightedSessionCard design.
class _PiHighlightedSessionCard extends ConsumerWidget {
  const _PiHighlightedSessionCard({
    required this.session,
    required this.highlightColor,
    required this.onTap,
    required this.onLongPress,
    required this.onDelete,
  });

  final PiSessionInfo session;
  final HighlightColor highlightColor;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    final status = sessionStatuses[session.id];
    final isActive = status != null && (status.isBusy || status.isRetry);
    final color = highlightColor.forBrightness(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    final bgColor = highlightColor.backgroundFor(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );

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
                            session.name ?? session.firstMessage,
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
                        if (session.parentSessionPath != null) ...[
                          SizedBox(width: Spacing.xs),
                          Icon(
                            AppIcons.forkRight,
                            size: 14,
                            color: ocTheme.info,
                          ),
                        ],
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
                            _formatDate(session.modified),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Meta row: agent icon + project
                    Row(
                      children: [
                        // Pi icon
                        Icon(
                          AppIcons.autoAwesome,
                          size: 12,
                          color: ocTheme.accent,
                        ),
                        const SizedBox(width: 6),
                        // Project name
                        Text(
                          _getProjectName(session),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        const Spacer(),
                        // Diff stats badges (or message count fallback)
                        if (session.summary != null &&
                            (session.summary!.additions > 0 ||
                                session.summary!.deletions > 0 ||
                                session.summary!.files > 0))
                          ..._buildStatBadges(session.summary, ocTheme)
                        else if (session.messageCount > 0)
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
        return false;
      },
      child: card,
    );
  }
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

String _getProjectName(PiSessionInfo session) {
  final parts = session.cwd.split('/').where((p) => p.isNotEmpty).toList();
  return parts.isEmpty ? 'Unknown' : parts.last;
}

List<Widget> _buildStatBadges(
  SessionSummaryStats? summary,
  OpenCodeTheme ocTheme,
) {
  if (summary == null) return [];
  final badges = <Widget>[];
  if (summary.additions > 0) {
    badges.add(
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        decoration: BoxDecoration(
          color: ocTheme.success.withValues(alpha: 0.12),
          borderRadius: Radii.brXs,
        ),
        child: Text(
          '+${summary.additions}',
          style: TextStyle(
            color: ocTheme.success,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
  if (summary.deletions > 0) {
    if (badges.isNotEmpty) badges.add(const SizedBox(width: 4));
    badges.add(
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        decoration: BoxDecoration(
          color: ocTheme.error.withValues(alpha: 0.12),
          borderRadius: Radii.brXs,
        ),
        child: Text(
          '-${summary.deletions}',
          style: TextStyle(
            color: ocTheme.error,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
  if (summary.files > 0) {
    if (badges.isNotEmpty) badges.add(const SizedBox(width: 4));
    badges.add(
      Container(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
        decoration: BoxDecoration(
          color: ocTheme.info.withValues(alpha: 0.12),
          borderRadius: Radii.brXs,
        ),
        child: Text(
          '${summary.files} files',
          style: TextStyle(
            color: ocTheme.info,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
  return badges;
}
