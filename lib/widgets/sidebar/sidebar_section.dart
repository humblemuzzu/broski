import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:flutter/material.dart';

/// One titled block of a session sidebar: an optional icon, the title, an
/// optional trailing figure and the block's content.
class SidebarSection extends StatelessWidget {
  const SidebarSection({
    super.key,
    required this.title,
    this.icon,
    this.trailing,
    required this.children,
  });

  final String title;
  final IconData? icon;
  final Widget? trailing;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (icon != null) ...[
              Icon(icon, size: 14, color: theme.textMuted),
              const SizedBox(width: 6),
            ],
            SectionHeader(title: title, theme: theme),
            if (trailing != null) ...[const Spacer(), trailing!],
          ],
        ),
        const SizedBox(height: 10),
        ...children,
      ],
    );
  }
}
