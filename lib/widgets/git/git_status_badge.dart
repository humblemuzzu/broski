import 'package:flutter/material.dart';

import '../../models/git.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

class GitStatusBadge extends StatelessWidget {
  const GitStatusBadge({super.key, required this.status});

  final GitChangeStatus status;

  Color _color(OpenCodeTheme theme) {
    switch (status) {
      case GitChangeStatus.added:
        return theme.success;
      case GitChangeStatus.deleted:
        return theme.error;
      case GitChangeStatus.renamed:
      case GitChangeStatus.copied:
        return theme.info;
      case GitChangeStatus.modified:
        return theme.warning;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final color = _color(theme);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: Radii.brFull,
        border: Border.all(color: color.withValues(alpha: 0.45)),
      ),
      child: Text(
        status.shortLabel,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w700,
          fontSize: 11,
        ),
      ),
    );
  }
}
