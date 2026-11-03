import 'package:broski/models/claude_code.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sidebar/sidebar_section.dart';
import 'package:flutter/material.dart';

/// The skills a Claude Code session has, as chips, sixteen of them at most.
class CCSkillsSection extends StatelessWidget {
  const CCSkillsSection({super.key, required this.init});

  final CCSessionInit init;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final skills = init.skills;
    return SidebarSection(
      title: 'Skills',
      icon: AppIcons.autoAwesome,
      children: [
        Wrap(
          spacing: 6,
          runSpacing: 6,
          children: [
            for (final skill in skills.take(16))
              _SkillChip(label: skill, theme: theme),
          ],
        ),
        if (skills.length > 16)
          Padding(
            padding: Insets.topSm,
            child: Text(
              '+${skills.length - 16} more',
              style: AppTypography.label(color: theme.textMuted),
            ),
          ),
      ],
    );
  }
}

class _SkillChip extends StatelessWidget {
  const _SkillChip({required this.label, required this.theme});

  final String label;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brFull,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Text(label, style: AppTypography.label(color: theme.text)),
    );
  }
}
