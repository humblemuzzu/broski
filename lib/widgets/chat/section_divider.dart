import 'package:flutter/material.dart';
import '../../theme/opencode_theme.dart';

/// A subtle horizontal divider for separating content sections.
/// Used between markdown headings and in detail sheets.
///
/// This divider is intentionally very subtle - it provides structure
/// without being visually heavy.
class SectionDivider extends StatelessWidget {
  /// Opacity of the divider line (0.0 to 1.0)
  final double opacity;

  /// Height/thickness of the divider line
  final double height;

  /// Margin around the divider
  final EdgeInsets margin;

  const SectionDivider({
    super.key,
    this.opacity = 0.15,
    this.height = 1.0,
    this.margin = const EdgeInsets.symmetric(vertical: 16),
  });

  /// A more prominent divider for larger sections (H1)
  const SectionDivider.prominent({
    super.key,
    this.opacity = 0.25,
    this.height = 1.0,
    this.margin = const EdgeInsets.symmetric(vertical: 20),
  });

  /// A minimal divider for smaller sections
  const SectionDivider.subtle({
    super.key,
    this.opacity = 0.10,
    this.height = 1.0,
    this.margin = const EdgeInsets.symmetric(vertical: 12),
  });

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Container(
      margin: margin,
      width: double.infinity,
      height: height,
      decoration: BoxDecoration(
        color: theme.textMuted.withValues(alpha: opacity),
        borderRadius: BorderRadius.circular(height / 2),
      ),
    );
  }
}

/// Creates a MarkdownStyleSheet addition for section dividers.
///
/// This provides consistent styling for markdown content that includes
/// subtle dividers after headings.
///
/// Usage in markdown rendering:
/// ```dart
/// MarkdownBody(
///   data: markdownText,
///   styleSheet: buildChatMarkdownStyle(theme).merge(
///     MarkdownStyleSheet(
///       h1Padding: EdgeInsets.only(bottom: 8),
///       h2Padding: EdgeInsets.only(bottom: 6),
///     ),
///   ),
/// )
/// ```
class MarkdownSectionStyle {
  /// Padding after H1 headings to leave room for divider
  static const EdgeInsets h1Padding = EdgeInsets.only(bottom: 16, top: 24);

  /// Padding after H2 headings
  static const EdgeInsets h2Padding = EdgeInsets.only(bottom: 12, top: 20);

  /// Padding after H3 headings
  static const EdgeInsets h3Padding = EdgeInsets.only(bottom: 8, top: 16);

  /// Block spacing between sections
  static const double blockSpacing = 16.0;
}

/// A widget that wraps content with optional section dividers.
///
/// Use this to wrap markdown sections when you want dividers
/// to appear between them.
class SectionContent extends StatelessWidget {
  final Widget child;
  final bool showDividerAbove;
  final bool showDividerBelow;

  const SectionContent({
    super.key,
    required this.child,
    this.showDividerAbove = false,
    this.showDividerBelow = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showDividerAbove) const SectionDivider.subtle(),
        child,
        if (showDividerBelow) const SectionDivider.subtle(),
      ],
    );
  }
}
