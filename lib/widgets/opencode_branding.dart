import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// OpenCode branding widget - displays the official OpenCode logo
/// Used in empty chat state for OpenCode sessions
/// Automatically switches between dark/light logo based on theme
class OpenCodeBranding extends StatelessWidget {
  const OpenCodeBranding({super.key, this.width = 200, this.opacity = 1.0});

  final double width;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    // Calculate height based on original SVG aspect ratio (234:42)
    final height = width * (42 / 234);

    // Detect if we're on a light or dark theme
    final theme = OpenCodeTheme.of(context);
    final isLightTheme = theme.background.computeLuminance() > 0.5;

    // Use appropriate logo for the theme
    final logoPath = isLightTheme
        ? 'docs/assets/opencode/opencode-logo-light.svg'
        : 'docs/assets/opencode/opencode-logo-dark.svg';

    return Opacity(
      opacity: opacity,
      child: SvgPicture.asset(
        logoPath,
        width: width,
        height: height,
        fit: BoxFit.contain,
      ),
    );
  }
}
