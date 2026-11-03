import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The bordered panel the sidebar's lists share: every item in it, a hairline
/// between two neighbours.
class SidebarDividedList extends StatelessWidget {
  const SidebarDividedList({super.key, required this.items});

  final List<Widget> items;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle, width: 1),
      ),
      child: Column(
        children: [
          for (int i = 0; i < items.length; i++) ...[
            items[i],
            if (i < items.length - 1)
              Divider(color: theme.borderSubtle, height: 1),
          ],
        ],
      ),
    );
  }
}
