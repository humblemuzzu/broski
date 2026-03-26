import 'package:flutter/material.dart';

import '../../models/permission_rule.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

/// Compact permission preset card for grid. Extracted from chat_screen.dart.
class PermissionPresetCard extends StatelessWidget {
  const PermissionPresetCard({
    super.key,
    required this.preset,
    required this.isSelected,
    required this.theme,
    required this.onTap,
  });
  final PermissionPreset preset;
  final bool isSelected;
  final OpenCodeTheme theme;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected
              ? theme.primary.withValues(alpha: 0.1)
              : theme.backgroundPanel,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isSelected ? theme.primary : theme.borderSubtle,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              preset.shortName,
              style: TextStyle(
                color: isSelected ? theme.primary : theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            SizedBox(height: Spacing.xxs),
            Text(
              preset.description,
              style: TextStyle(color: theme.textMuted, fontSize: 10),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
