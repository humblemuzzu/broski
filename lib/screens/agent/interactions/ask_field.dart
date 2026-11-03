import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The field the app's prompts put in front of a person: filled, softly
/// bordered, and lit in [focus] once it holds the keyboard.
InputDecoration askInput(
  OpenCodeTheme theme, {
  String? hint,
  String? helper,
  Color? focus,
}) => InputDecoration(
  hintText: hint,
  hintStyle: AppTypography.body(color: theme.textMuted.withValues(alpha: 0.5)),
  helperText: helper,
  helperStyle: AppTypography.caption(color: theme.textMuted),
  filled: true,
  fillColor: theme.backgroundElement,
  contentPadding: Insets.cardSm,
  border: OutlineInputBorder(
    borderRadius: Radii.brMd,
    borderSide: BorderSide(color: theme.borderSubtle),
  ),
  enabledBorder: OutlineInputBorder(
    borderRadius: Radii.brMd,
    borderSide: BorderSide(color: theme.borderSubtle),
  ),
  focusedBorder: OutlineInputBorder(
    borderRadius: Radii.brMd,
    borderSide: BorderSide(color: focus ?? theme.primary, width: 1.5),
  ),
);

/// The small muted line the prompts put above a field.
class AskFieldLabel extends StatelessWidget {
  const AskFieldLabel({super.key, required this.text, this.color});

  final String text;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.bottomSm,
      child: Text(
        text,
        style: AppTypography.label(color: color ?? theme.textMuted),
      ),
    );
  }
}
