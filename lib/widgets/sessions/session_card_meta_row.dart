import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sessions/session_card_view.dart';
import 'package:flutter/material.dart';

/// The bottom line of a session card: the glyph that stands for the agent, the
/// project, the model and the branch, then the figures on the right.
class SessionCardMetaRow extends StatelessWidget {
  const SessionCardMetaRow({
    super.key,
    required this.meta,
    required this.onActions,
  });

  final SessionCardMeta meta;

  /// Null when the backend allows no action on this session.
  final VoidCallback? onActions;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      children: [
        if (meta.icon case final icon?) ...[
          Icon(icon, size: 12, color: meta.iconColor ?? theme.accent),
          if (meta.project case final project?) ...[
            const SizedBox(width: 6),
            Text(
              project,
              style: TextStyle(color: theme.textMuted, fontSize: 12),
            ),
          ],
        ],
        if (meta.model case final model?) ...[
          const SizedBox(width: Spacing.sm),
          _ModelBadge(text: model, theme: theme),
        ],
        if (meta.branch case final branch?) ...[
          Text(
            ' \u00b7 ',
            style: TextStyle(
              color: theme.textMuted.withValues(alpha: 0.5),
              fontSize: 12,
            ),
          ),
          Flexible(
            child: Text(
              branch,
              style: TextStyle(color: theme.textMuted, fontSize: 12),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
        const Spacer(),
        ...meta.stats,
        if (meta.stats.isEmpty && (meta.messageCount ?? 0) > 0)
          Text(
            '${meta.messageCount} msgs',
            style: TextStyle(color: theme.textMuted, fontSize: 11),
          ),
        if (onActions case final open?)
          _ActionsButton(onPressed: open, theme: theme),
      ],
    );
  }
}

class _ActionsButton extends StatelessWidget {
  const _ActionsButton({required this.onPressed, required this.theme});

  final VoidCallback onPressed;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Tooltip(
    message: 'Actions',
    child: InkWell(
      onTap: onPressed,
      borderRadius: Radii.brXs,
      child: Padding(
        padding: const EdgeInsets.only(left: Spacing.sm),
        child: Icon(AppIcons.moreVertical, size: 16, color: theme.textMuted),
      ),
    ),
  );
}

class _ModelBadge extends StatelessWidget {
  const _ModelBadge({required this.text, required this.theme});

  final String text;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
    decoration: BoxDecoration(
      color: theme.info.withValues(alpha: 0.12),
      borderRadius: Radii.brXs,
    ),
    child: Text(
      text,
      style: TextStyle(
        color: theme.info,
        fontSize: 10,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}
