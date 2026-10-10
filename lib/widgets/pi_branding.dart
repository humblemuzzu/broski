import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Pi branding widget - displays the official Pi logo.
/// Used in empty chat state for Pi sessions.
/// Automatically switches between dark/light logo based on theme.
class PiBranding extends StatelessWidget {
  const PiBranding({
    super.key,
    this.width = 200,
    this.opacity = 1.0,
    this.durable = false,
  });

  final double width;
  final double opacity;

  /// Draws the durable badge over the logo instead of a separate mark: Pi
  /// Durable is the same product with a different persistence guarantee.
  final bool durable;

  @override
  Widget build(BuildContext context) {
    // Pi logo is square (800x800 viewBox)
    final height = width;

    // Detect if we're on a light or dark theme
    final theme = OpenCodeTheme.of(context);
    final isLightTheme = theme.background.computeLuminance() > 0.5;

    // Use appropriate logo for the theme
    final logoPath = isLightTheme
        ? 'assets/logos/pi/pi-logo-light.svg'
        : 'assets/logos/pi/pi-logo-dark.svg';

    final logo = Opacity(
      opacity: opacity,
      child: SvgPicture.asset(
        logoPath,
        width: width,
        height: height,
        fit: BoxFit.contain,
      ),
    );
    if (!durable) return logo;

    return Stack(
      alignment: Alignment.center,
      children: [
        logo,
        const Positioned(right: 0, bottom: 0, child: PiDurableBadge()),
      ],
    );
  }
}

/// Small "durable" marker next to Pi branding, where a full logo would be out
/// of place (pickers, session cards).
class PiDurableBadge extends StatelessWidget {
  const PiDurableBadge({super.key, this.label = 'durable'});

  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: theme.primary.withValues(alpha: 0.16),
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.primary.withValues(alpha: 0.45)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: theme.primary,
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}
