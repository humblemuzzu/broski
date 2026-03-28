import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

// Glass pill widget for header elements
// FIX: Removed expensive BackdropFilter - uses simple semi-transparent background instead
// BackdropFilter causes severe frame drops during scrolling as it rasterizes everything behind it
class GlassPill extends StatelessWidget {
  const GlassPill({
    super.key,
    required this.child,
    this.onTap,
    this.compact = false,
    this.constraints,
  });
  final Widget child;
  final VoidCallback? onTap;
  final bool compact;
  final BoxConstraints? constraints;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final kCard = theme.backgroundPanel;
    final borderRadius = compact ? Radii.brLg : Radii.brXl;
    // FIX: Simple semi-transparent container instead of expensive BackdropFilter
    // The visual difference is minimal but performance improvement is significant
    return GestureDetector(
      onTap: onTap,
      child: Container(
        constraints: constraints,
        padding: compact
            ? Insets.cardXs
            : const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          // Slightly higher opacity to compensate for lack of blur
          color: kCard.withValues(alpha: 0.85),
          borderRadius: borderRadius,
          // Add subtle border for definition
          border: Border.all(
            color: theme.border.withValues(alpha: 0.3),
            width: 0.5,
          ),
        ),
        child: child,
      ),
    );
  }
}
