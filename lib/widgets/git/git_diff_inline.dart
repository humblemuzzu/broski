import 'package:flutter/material.dart';
import '../../theme/opencode_theme.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../widgets/chat/detail_sheet.dart';

class GitDiffInline extends StatelessWidget {
  const GitDiffInline({super.key, required this.title, required this.diff});

  final String title;
  final String diff;

  static Future<void> show({
    required BuildContext context,
    required String title,
    required String diff,
  }) {
    return DetailSheet.show<void>(
      context: context,
      title: title,
      initialSize: 0.75,
      maxSize: 0.95,
      child: GitDiffInline(title: title, diff: diff),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (diff.trim().isEmpty) {
      return const Padding(
        padding: Insets.card,
        child: Text('No diff output.'),
      );
    }

    return Padding(
      padding: Insets.cardSm,
      child: Container(
        width: double.infinity,
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: OpenCodeTheme.of(context).bgHighlight.withValues(alpha: 0.35),
          borderRadius: Radii.brMd,
        ),
        child: SelectableText(
          diff,
          style: AppTypography.codeSmall().copyWith(
            height: 1.45,
          ),
        ),
      ),
    );
  }
}
