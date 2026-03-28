import 'package:broski/models/project.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Project tile for Pi session creation. Extracted from sessions_screen.dart.
class PiProjectTile extends StatelessWidget {
  const PiProjectTile({
    super.key,
    required this.project,
    required this.hasExistingSessions,
    required this.onTap,
  });

  final ProjectSummary project;
  final bool hasExistingSessions;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.brMd,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: ocTheme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(
              color: hasExistingSessions
                  ? ocTheme.primary.withValues(alpha: 0.3)
                  : ocTheme.borderSubtle,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: hasExistingSessions
                      ? ocTheme.primary.withValues(alpha: 0.12)
                      : ocTheme.backgroundElement,
                  borderRadius: Radii.brSm,
                ),
                child: Icon(
                  AppIcons.folder,
                  size: 16,
                  color: hasExistingSessions
                      ? ocTheme.primary
                      : ocTheme.textMuted,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      project.name,
                      style: TextStyle(
                        color: ocTheme.text,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      project.path,
                      style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              if (hasExistingSessions)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: ocTheme.primary.withValues(alpha: 0.12),
                    borderRadius: Radii.brXs,
                  ),
                  child: Text(
                    'Active',
                    style: TextStyle(
                      color: ocTheme.primary,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              const SizedBox(width: 4),
              Icon(AppIcons.chevronRight, size: 18, color: ocTheme.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}
