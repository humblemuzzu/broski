import 'package:broski/models/session.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Build stat badges for CC/Codex/Pi session cards from a [SessionSummaryStats].
/// Returns empty list if no meaningful stats.
List<Widget> buildSessionStatBadges(
  SessionSummaryStats? summary,
  OpenCodeTheme ocTheme,
) {
  if (summary == null ||
      (summary.additions == 0 &&
          summary.deletions == 0 &&
          summary.files == 0)) {
    return [];
  }
  return [
    if (summary.additions > 0)
      StatBadge(text: '+${summary.additions}', color: ocTheme.diffAdded),
    if (summary.deletions > 0) ...[
      const SizedBox(width: 6),
      StatBadge(text: '-${summary.deletions}', color: ocTheme.diffRemoved),
    ],
    if (summary.files > 0) ...[
      const SizedBox(width: 6),
      Text(
        '${summary.files} ${summary.files == 1 ? 'file' : 'files'}',
        style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
      ),
    ],
  ];
}

/// Small stat badge for session cards (additions, deletions, files)
class StatBadge extends StatelessWidget {
  const StatBadge({super.key, required this.text, required this.color});
  final String text;
  final Color color;
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.brXs,
      ),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontSize: 10,
          fontWeight: FontWeight.w600,
          fontFamily: AppTypography.codeFontFamily,
        ),
      ),
    );
  }
}
