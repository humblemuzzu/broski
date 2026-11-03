import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A labelled fact in the sidebar's info section, its value on the right.
class SidebarInfoRow extends StatelessWidget {
  const SidebarInfoRow({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Row(
        children: [
          Icon(icon, size: 16, color: theme.textMuted),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              label,
              style: AppTypography.bodySmall(color: theme.textMuted),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 13,
              color: theme.text,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
