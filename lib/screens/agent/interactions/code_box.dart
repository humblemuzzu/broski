import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The app's code panel: the element background, a soft border and monospace
/// text, under an optional label and over an optional footnote.
class CodeBox extends StatelessWidget {
  const CodeBox({
    super.key,
    required this.text,
    this.title,
    this.footnote,
    this.textColor,
  });

  final String text;
  final String? title;
  final String? footnote;
  final Color? textColor;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (title case final title?)
          Padding(
            padding: Insets.bottomSm,
            child: Text(
              title,
              style: TextStyle(
                color: theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        Container(
          width: double.infinity,
          padding: Insets.cardSm,
          decoration: BoxDecoration(
            color: theme.backgroundElement,
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SelectableText(
                text,
                style: AppTypography.codeSmall(color: textColor ?? theme.text),
              ),
              if (footnote case final footnote?)
                Padding(
                  padding: Insets.topSm,
                  child: Text(
                    footnote,
                    style: AppTypography.caption(color: theme.textMuted),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
