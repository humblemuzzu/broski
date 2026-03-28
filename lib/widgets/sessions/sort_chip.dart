import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Sort chip for toggling between updatedAt/createdAt. Extracted from sessions_screen.dart.
class SortChip extends StatelessWidget {
  const SortChip({super.key, required this.sortBy, required this.onChanged});
  final String sortBy;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final isUpdatedAt = sortBy == 'updatedAt';
    return InkWell(
      onTap: () => onChanged(isUpdatedAt ? 'createdAt' : 'updatedAt'),
      borderRadius: Radii.brFull,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brFull,
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.sort, size: 14, color: ocTheme.textMuted),
            const SizedBox(width: 6),
            Text(
              isUpdatedAt ? 'Updated' : 'Created',
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
