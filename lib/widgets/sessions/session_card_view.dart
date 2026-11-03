import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_card_meta_row.dart';
import 'package:flutter/material.dart';

/// What a card's meta row reads: the glyph standing for the agent, the project
/// it works in, the model it runs on, its branch, and the figures on the right.
final class SessionCardMeta {
  const SessionCardMeta({
    this.icon,
    this.iconColor,
    this.project,
    this.model,
    this.branch,
    this.stats = const [],
    this.messageCount,
  });

  final IconData? icon;
  final Color? iconColor;
  final String? project;
  final String? model;
  final String? branch;

  /// Badges the caller built, laid out at the row's right end.
  final List<Widget> stats;

  /// Shown in place of [stats] while it is empty.
  final int? messageCount;
}

/// What a session is doing while it is not simply sitting between runs.
final class SessionCardState {
  const SessionCardState({
    required this.label,
    required this.color,
    this.working = false,
  });

  final String label;
  final Color color;

  /// Whether it is a run in progress, which spins rather than only reads.
  final bool working;
}

/// What marks a card as highlighted: its bar and star, and what it sits on.
final class SessionCardHighlight {
  const SessionCardHighlight({required this.accent, required this.background});

  final Color accent;
  final Color background;
}

/// One session as a panel with a coloured edge: its title, an optional tag,
/// the first thing said in it, and the meta row of project, model, branch and
/// figures. A running session shows a spinner and its state instead of the
/// time. With [onDelete] the panel swipes to delete, and with [onActions] it
/// carries the button that opens the row's actions.
class SessionCardView extends StatelessWidget {
  const SessionCardView({
    super.key,
    required this.title,
    required this.meta,
    required this.onTap,
    this.preview,
    this.tag,
    this.timeText,
    this.state,
    this.highlight,
    this.isChild = false,
    this.onLongPress,
    this.onActions,
    this.onDelete,
    this.dismissKey,
  });

  final String title;
  final SessionCardMeta meta;
  final VoidCallback onTap;

  /// The first prompt, when it says more than the title.
  final String? preview;
  final String? tag;

  /// How long ago the session last changed, read while it is not running.
  final String? timeText;

  /// What the session is doing, when it is doing something: its label, its
  /// colour, and whether it is working rather than waiting.
  final SessionCardState? state;

  final SessionCardHighlight? highlight;

  /// A session a subagent or a fork ran, marked as one.
  final bool isChild;
  final VoidCallback? onLongPress;

  /// Null when the backend allows no action on this row.
  final VoidCallback? onActions;

  /// Swipes this card to delete; [dismissKey] identifies it across rebuilds.
  final VoidCallback? onDelete;
  final Key? dismissKey;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final card = GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: _CardBody(this),
    );
    final delete = onDelete;
    final key = dismissKey;
    if (delete == null || key == null) return card;
    return Dismissible(
      key: key,
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(color: theme.error, borderRadius: Radii.brMd),
        child: Icon(
          AppIcons.delete,
          color: theme.selectedListItemText,
          size: 24,
        ),
      ),
      confirmDismiss: (_) async {
        delete();
        return false;
      },
      child: card,
    );
  }
}

class _CardBody extends StatelessWidget {
  const _CardBody(this.card);

  final SessionCardView card;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: card.highlight?.background ?? theme.backgroundPanel,
        borderRadius: Radii.brMd,
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        children: [
          _Edge(highlight: card.highlight, state: card.state, theme: theme),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
              child: _CardLines(card: card, theme: theme),
            ),
          ),
        ],
      ),
    );
  }
}

class _CardLines extends StatelessWidget {
  const _CardLines({required this.card, required this.theme});

  final SessionCardView card;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    final preview = card.preview;
    final tag = card.tag;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _TitleRow(
          title: card.title,
          timeText: card.timeText,
          state: card.state,
          highlight: card.highlight,
          isChild: card.isChild,
          theme: theme,
        ),
        if (tag case final tag? when tag.isNotEmpty) ...[
          const SizedBox(height: 6),
          _Tag(text: tag, theme: theme),
        ],
        if (preview != null && preview.isNotEmpty && preview != card.title) ...[
          const SizedBox(height: 4),
          Text(
            preview,
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 12.5,
              height: 1.3,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
        const SizedBox(height: 10),
        SessionCardMetaRow(meta: card.meta, onActions: card.onActions),
      ],
    );
  }
}

class _Edge extends StatelessWidget {
  const _Edge({
    required this.highlight,
    required this.state,
    required this.theme,
  });

  final SessionCardHighlight? highlight;
  final SessionCardState? state;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    final color =
        highlight?.accent ??
        state?.color ??
        theme.accent.withValues(alpha: 0.4);
    return Container(
      width: 3,
      decoration: BoxDecoration(
        color: color,
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(10),
          bottomLeft: Radius.circular(10),
        ),
      ),
    );
  }
}

class _TitleRow extends StatelessWidget {
  const _TitleRow({
    required this.title,
    required this.timeText,
    required this.state,
    required this.highlight,
    required this.isChild,
    required this.theme,
  });

  final String title;
  final String? timeText;
  final SessionCardState? state;
  final SessionCardHighlight? highlight;
  final bool isChild;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Row(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (highlight case final mark?) ...[
        Icon(AppIcons.star, size: 16, color: mark.accent),
        const SizedBox(width: Spacing.sm),
      ],
      Expanded(
        child: Text(
          title,
          style: TextStyle(
            color: theme.text,
            fontSize: 15,
            fontWeight: FontWeight.w600,
            height: 1.3,
          ),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      if (isChild) ...[
        const SizedBox(width: Spacing.xs),
        Icon(AppIcons.gitBranch, size: 14, color: theme.info),
      ],
      const SizedBox(width: Spacing.md),
      _StateText(state: state, timeText: timeText, theme: theme),
    ],
  );
}

class _StateText extends StatelessWidget {
  const _StateText({
    required this.state,
    required this.timeText,
    required this.theme,
  });

  final SessionCardState? state;
  final String? timeText;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    final state = this.state;
    if (state == null) {
      final time = timeText;
      return time == null
          ? const SizedBox.shrink()
          : Text(time, style: TextStyle(color: theme.textMuted, fontSize: 12));
    }
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (state.working) ...[
          SizedBox(
            width: 10,
            height: 10,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              valueColor: AlwaysStoppedAnimation<Color>(state.color),
            ),
          ),
          const SizedBox(width: 6),
        ],
        Text(
          state.label,
          style: TextStyle(
            color: state.color,
            fontSize: 11,
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.text, required this.theme});

  final String text;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    decoration: BoxDecoration(
      color: theme.accent.withValues(alpha: 0.12),
      borderRadius: Radii.brXs,
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(AppIcons.star, size: 10, color: theme.accent),
        const SizedBox(width: 4),
        Text(
          text,
          style: TextStyle(
            color: theme.accent,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    ),
  );
}
