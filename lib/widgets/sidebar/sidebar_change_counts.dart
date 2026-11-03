import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A section's added and removed line counts, as its trailing figure.
class SidebarChangeCounts extends StatelessWidget {
  const SidebarChangeCounts({
    super.key,
    required this.additions,
    required this.deletions,
  });

  final int additions;
  final int deletions;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '+$additions',
          style: TextStyle(
            fontSize: 12,
            color: theme.success,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(width: 6),
        Text(
          '-$deletions',
          style: TextStyle(
            fontSize: 12,
            color: theme.error,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
