import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A row of a short action sheet, as the chat's message actions and
/// attachment sheet draw one: an icon in the primary colour, what it does,
/// and a line on what that means.
class SheetActionTile extends StatelessWidget {
  const SheetActionTile({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.detail,
  });

  final IconData icon;
  final String label;
  final String? detail;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ListTile(
      leading: Icon(icon, color: theme.primary),
      title: Text(
        label,
        style: TextStyle(color: theme.text, fontWeight: FontWeight.w500),
      ),
      subtitle: switch (detail) {
        null => null,
        final detail => Text(
          detail,
          style: AppTypography.label(color: theme.textMuted),
        ),
      },
      onTap: onTap,
    );
  }
}
