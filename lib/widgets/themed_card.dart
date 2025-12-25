import 'package:flutter/material.dart';

import '../theme/opencode_theme.dart';

/// Elevation levels for themed cards
enum CardElevation {
  /// Uses background color (deepest)
  background,

  /// Uses panel color (standard cards)
  panel,

  /// Uses element color (inputs, code blocks)
  element,
}

/// A themed card widget that uses OpenCodeTheme colors.
///
/// Replaces scattered Container decorations with consistent styling
/// across the entire app.
class ThemedCard extends StatelessWidget {
  const ThemedCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.margin,
    this.borderRadius = 16,
    this.showBorder = true,
    this.elevation = CardElevation.panel,
    this.onTap,
    this.onLongPress,
  });

  /// The content of the card
  final Widget child;

  /// Padding inside the card
  final EdgeInsetsGeometry padding;

  /// Margin around the card
  final EdgeInsetsGeometry? margin;

  /// Border radius in pixels
  final double borderRadius;

  /// Whether to show a border
  final bool showBorder;

  /// The elevation level (determines background color)
  final CardElevation elevation;

  /// Optional tap callback
  final VoidCallback? onTap;

  /// Optional long press callback
  final VoidCallback? onLongPress;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    final bgColor = switch (elevation) {
      CardElevation.background => theme.background,
      CardElevation.panel => theme.backgroundPanel,
      CardElevation.element => theme.backgroundElement,
    };

    final decoration = BoxDecoration(
      color: bgColor,
      borderRadius: BorderRadius.circular(borderRadius),
      border: showBorder
          ? Border.all(color: theme.borderSubtle, width: 1)
          : null,
    );

    Widget card = Container(
      margin: margin,
      padding: padding,
      decoration: decoration,
      child: child,
    );

    if (onTap != null || onLongPress != null) {
      card = Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          borderRadius: BorderRadius.circular(borderRadius),
          child: card,
        ),
      );
    }

    return card;
  }
}

/// A glass-effect card for floating headers and overlays
class GlassCard extends StatelessWidget {
  const GlassCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    this.borderRadius = 20,
    this.opacity = 0.7,
    this.blur = 10,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final double borderRadius;
  final double opacity;
  final double blur;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    Widget content = Container(
      padding: padding,
      decoration: BoxDecoration(
        color: theme.backgroundPanel.withValues(alpha: opacity),
        borderRadius: BorderRadius.circular(borderRadius),
        border: Border.all(
          color: theme.border.withValues(alpha: 0.2),
          width: 0.5,
        ),
      ),
      child: child,
    );

    if (onTap != null) {
      content = GestureDetector(onTap: onTap, child: content);
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: content,
    );
  }
}

/// A section container with title and optional icon
class ThemedSection extends StatelessWidget {
  const ThemedSection({
    super.key,
    required this.title,
    this.icon,
    this.trailing,
    required this.children,
    this.spacing = 10,
  });

  final String title;
  final IconData? icon;
  final Widget? trailing;
  final List<Widget> children;
  final double spacing;

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
            Text(
              title,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: theme.textMuted,
                letterSpacing: 0.5,
              ),
            ),
            if (trailing != null) ...[const Spacer(), trailing!],
          ],
        ),
        SizedBox(height: spacing),
        ...children,
      ],
    );
  }
}

/// A list tile with themed styling
class ThemedListTile extends StatelessWidget {
  const ThemedListTile({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.trailing,
    this.onTap,
    this.showBorder = true,
    this.padding = const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
  });

  final String title;
  final String? subtitle;
  final Widget? leading;
  final Widget? trailing;
  final VoidCallback? onTap;
  final bool showBorder;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return ThemedCard(
      padding: padding,
      showBorder: showBorder,
      onTap: onTap,
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: 12)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: theme.text,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: TextStyle(fontSize: 12, color: theme.textMuted),
                  ),
                ],
              ],
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

/// A badge with themed colors
class ThemedBadge extends StatelessWidget {
  const ThemedBadge({
    super.key,
    required this.label,
    this.color,
    this.icon,
    this.small = false,
  });

  final String label;
  final Color? color;
  final IconData? icon;
  final bool small;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final badgeColor = color ?? theme.primary;

    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: small ? 6 : 8,
        vertical: small ? 2 : 4,
      ),
      decoration: BoxDecoration(
        color: badgeColor.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(small ? 4 : 6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: small ? 10 : 12, color: badgeColor),
            SizedBox(width: small ? 3 : 4),
          ],
          Text(
            label,
            style: TextStyle(
              fontSize: small ? 10 : 12,
              fontWeight: FontWeight.w600,
              color: badgeColor,
            ),
          ),
        ],
      ),
    );
  }
}

/// An icon container with themed background
class ThemedIconBox extends StatelessWidget {
  const ThemedIconBox({
    super.key,
    required this.icon,
    this.color,
    this.size = 40,
    this.iconSize = 20,
    this.borderRadius = 10,
  });

  final IconData icon;
  final Color? color;
  final double size;
  final double iconSize;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final iconColor = color ?? theme.textMuted;

    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: iconColor.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(borderRadius),
      ),
      child: Icon(icon, color: iconColor, size: iconSize),
    );
  }
}
