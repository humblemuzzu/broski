import 'package:broski/models/claude_code.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_card_text.dart';
import 'package:broski/widgets/sessions/session_card_view.dart';
import 'package:broski/widgets/sessions/session_stat_badges.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A Claude Code session in the list: its card, with what its run is doing and
/// what it changed.
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final status = ref.watch(globalSessionStatusProvider)[session.id];
    final running = status != null && (status.isBusy || status.isRetry);
    return SessionCardView(
      title: session.displayTitle,
      preview: session.firstPrompt,
      tag: session.tag,
      timeText: sessionTimeText(session.updatedAt),
      state: running
          ? SessionCardState(
              label: status.isRetry ? 'Retry' : 'Working',
              color: status.isRetry ? theme.warning : theme.info,
              working: true,
            )
          : null,
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
