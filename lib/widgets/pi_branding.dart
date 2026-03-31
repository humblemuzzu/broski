import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Pi branding widget - displays the official Pi logo.
/// Used in empty chat state for Pi sessions.
/// Automatically switches between dark/light logo based on theme.
class PiBranding extends StatelessWidget {
  const PiBranding({super.key, this.width = 200, this.opacity = 1.0});

  final double width;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    // Pi logo is square (800x800 viewBox)
    final height = width;

    // Detect if we're on a light or dark theme
    final theme = OpenCodeTheme.of(context);
    final isLightTheme = theme.background.computeLuminance() > 0.5;

    // Use appropriate logo for the theme
    final logoPath = isLightTheme
        ? 'docs/assets/pi/pi-logo-light.svg'
        : 'docs/assets/pi/pi-logo-dark.svg';

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
