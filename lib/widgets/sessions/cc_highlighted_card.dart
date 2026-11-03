import 'package:broski/models/claude_code.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_card_text.dart';
import 'package:broski/widgets/sessions/session_card_view.dart';
import 'package:broski/widgets/sessions/session_stat_badges.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A highlighted Claude Code session: the same card in the highlight colour,
/// with the star that says why it is at the top of the list.
class CCHighlightedSessionCard extends ConsumerWidget {
  const CCHighlightedSessionCard({
    super.key,
    required this.session,
    required this.highlightColor,
    required this.onTap,
    required this.onLongPress,
    required this.onDelete,
  });

  final ClaudeCodeSession session;
  final HighlightColor highlightColor;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final brightness = Theme.of(context).brightness;
    final status = ref.watch(globalSessionStatusProvider)[session.id];
    final running = status != null && (status.isBusy || status.isRetry);
    return SessionCardView(
      title: session.displayTitle,
      timeText: sessionTimeText(session.updatedAt),
      state: running
          ? SessionCardState(
              label: status.isRetry ? 'Retry' : 'Working',
              color: status.isRetry ? theme.warning : theme.info,
              working: true,
            )
          : null,
      highlight: SessionCardHighlight(
        accent: highlightColor.forBrightness(
          brightness,
          themePrimary: theme.primary,
        ),
        background: highlightColor.backgroundFor(
          brightness,
          themePrimary: theme.primary,
        ),
      ),
      isChild: session.isSubagentSession,
      meta: SessionCardMeta(
        icon: AppIcons.terminal,
        iconColor: theme.accent,
        project: sessionProjectName(session.cwd),
        model: session.model?.split('/').last,
        branch: session.gitBranch,
        stats: buildSessionStatBadges(session.summary, theme),
        messageCount: session.messageCount,
      ),
      onTap: onTap,
      onLongPress: onLongPress,
      dismissKey: ValueKey(session.id),
      onDelete: onDelete,
    );
  }
}
