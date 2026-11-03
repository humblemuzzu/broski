import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A card one row of a list sits on.
class PanelCard extends StatelessWidget {
  const PanelCard({
    super.key,
    required this.child,
    this.onTap,
    this.padding = Insets.cardSm,
    this.color,
  });

  final Widget child;
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: padding,
        decoration: BoxDecoration(
          color: color ?? theme.backgroundPanel,
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: child,
      ),
    );
  }
}
