import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:flutter/material.dart';

/// One titled block of a picker: the app's uppercase section label, the line
/// saying what the section is for, then its choices.
class PickerSection extends StatelessWidget {
  const PickerSection({
    super.key,
    required this.title,
    required this.children,
    this.caption,
  });

  final String title;
  final String? caption;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SectionHeader(title: title.toUpperCase(), theme: theme),
          if (caption case final caption?)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.xxs),
              child: Text(
                caption,
                style: AppTypography.label(color: theme.textMuted),
              ),
            ),
          const SizedBox(height: Spacing.xs),
          ...children,
        ],
      ),
    );
  }
}
