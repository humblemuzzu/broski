import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// OpenCode branding widget - displays the official OpenCode logo
/// Used in empty chat state for OpenCode sessions
class OpenCodeBranding extends StatelessWidget {
  const OpenCodeBranding({super.key, this.width = 200, this.opacity = 0.12});

  final double width;
  final double opacity;

  @override
  Widget build(BuildContext context) {
    // Calculate height based on original SVG aspect ratio (234:42)
    final height = width * (42 / 234);

    return Opacity(
      opacity: opacity,
      child: SvgPicture.asset(
        'docs/assets/opencode/opencode-logo-dark.svg',
        width: width,
        height: height,
        fit: BoxFit.contain,
      ),
    );
  }
}
