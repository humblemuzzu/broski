import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The kinds of button the app's prompts offer, in the colours those prompts
/// gave them: the deny outline, the once-only allow, the session and always
/// allows, a dialog's primary action, and a quiet way out.
enum AnswerTone { primary, once, session, always, deny, muted }

typedef _Look = ({Color ink, Color fill, Color border, bool outlined});

/// One answer button's face: its colours and radii, with no gesture of its
/// own, for a control that raises the tap itself.
class AnswerFace extends StatelessWidget {
  const AnswerFace({
    super.key,
    required this.label,
    this.tone = AnswerTone.once,
    this.detail,
    this.icon,
    this.selected = false,
    this.enabled = true,
  });

  final String label;
  final AnswerTone tone;
  final String? detail;
  final IconData? icon;
  final bool selected;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final look = _look(theme);
    final ink = enabled ? look.ink : theme.textMuted.withValues(alpha: 0.4);
    return AnimatedContainer(
      duration: const Duration(milliseconds: 150),
      constraints: const BoxConstraints(minHeight: 44),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: _fill(theme, look),
        borderRadius: Radii.brMd,
        border: Border.all(
          color: _border(theme, look),
          width: selected ? 2 : 1,
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _label(ink),
          if (detail case final detail?)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.xxs),
              child: Text(
                detail,
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: ink.withValues(alpha: 0.75),
                  fontSize: 11,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _label(Color ink) {
    final glyph = selected ? AppIcons.check : icon;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (glyph case final glyph?) ...[
          Icon(glyph, size: 15, color: ink),
          const SizedBox(width: Spacing.sm),
        ],
        Flexible(
          child: Text(
            label,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: ink,
              fontSize: 13.5,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }

  Color _fill(OpenCodeTheme theme, _Look look) {
    if (!enabled) return theme.bgRaised;
    if (!selected) return look.fill;
    return look.outlined ? look.ink.withValues(alpha: 0.12) : look.fill;
  }

  Color _border(OpenCodeTheme theme, _Look look) {
    if (!enabled) return theme.borderSubtle.withValues(alpha: 0.2);
    if (!selected) return look.border;
    return look.outlined
        ? look.ink
        : theme.selectedListItemText.withValues(alpha: 0.85);
  }

  _Look _look(OpenCodeTheme theme) => switch (tone) {
    AnswerTone.primary => (
      ink: theme.selectedListItemText,
      fill: theme.primary,
      border: theme.primary,
      outlined: false,
    ),
    AnswerTone.always => (
      ink: theme.selectedListItemText,
      fill: theme.accent,
      border: theme.accent,
      outlined: false,
    ),
    AnswerTone.once => (
      ink: theme.accent,
      fill: theme.bgRaised,
      border: theme.accent.withValues(alpha: 0.5),
      outlined: true,
    ),
    AnswerTone.session => (
      ink: theme.info,
      fill: theme.bgRaised,
      border: theme.info.withValues(alpha: 0.5),
      outlined: true,
    ),
    AnswerTone.deny => (
      ink: theme.error,
      fill: theme.bgRaised,
      border: theme.error.withValues(alpha: 0.5),
      outlined: true,
    ),
    AnswerTone.muted => (
      ink: theme.textMuted,
      fill: theme.bgRaised,
      border: theme.borderSubtle,
      outlined: true,
    ),
  };
}

/// An answer the person can give, as one of the prompt's buttons. No [onTap]
/// draws it as the prompts drew a button that is not available yet.
class AnswerButton extends StatelessWidget {
  const AnswerButton({
    super.key,
    required this.label,
    required this.onTap,
    this.tone = AnswerTone.once,
    this.detail,
    this.icon,
    this.selected = false,
  });

  final String label;
  final VoidCallback? onTap;
  final AnswerTone tone;
  final String? detail;
  final IconData? icon;
  final bool selected;

  @override
  Widget build(BuildContext context) => GestureDetector(
    behavior: HitTestBehavior.opaque,
    onTap: onTap,
    child: AnswerFace(
      label: label,
      tone: tone,
      detail: detail,
      icon: icon,
      selected: selected,
      enabled: onTap != null,
    ),
  );
}
