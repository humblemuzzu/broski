import 'dart:io';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/appearance_provider.dart';
import '../theme/opencode_theme.dart';

/// Reusable custom background widget that renders the user's chosen
/// background image or shade with opacity and blur settings.
///
/// Specify a [screenId] to enable per-screen background control.
/// If no screenId is provided, the background always shows (if configured).
///
/// Use this as a Stack layer behind your screen content:
/// ```dart
/// Scaffold(
///   body: Stack(
///     children: [
///       const AppBackground(screenId: AppScreen.chat),
///       // Your screen content here
///     ],
///   ),
/// )
/// ```
class AppBackground extends ConsumerWidget {
  const AppBackground({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appearance = ref.watch(appearanceProvider);
    final ocTheme = OpenCodeTheme.of(context);

    // Priority: Custom image > Custom shade > Nothing
    if (appearance.hasCustomBackground) {
      return _ImageBackgroundLayer(
        imagePath: appearance.customBackgroundPath!,
        opacity: appearance.backgroundOpacity,
        blur: appearance.backgroundBlur,
      );
    }

    if (appearance.hasCustomShade) {
      final shadeColor = _getShadeColor(appearance.selectedShade, ocTheme);
      if (shadeColor != null) {
        return _ShadeBackgroundLayer(color: shadeColor);
      }
    }

    return const SizedBox.shrink();
  }

  /// Get the color for a given shade from the theme
  Color? _getShadeColor(BackgroundShade shade, OpenCodeTheme ocTheme) {
    switch (shade) {
      case BackgroundShade.none:
        return null;
      case BackgroundShade.deep:
        return ocTheme.bgDeep;
      case BackgroundShade.base:
        return ocTheme.background;
      case BackgroundShade.raised:
        return ocTheme.bgRaised;
      case BackgroundShade.hover:
        return ocTheme.bgHover;
      case BackgroundShade.active:
        return ocTheme.bgActive;
      case BackgroundShade.highlight:
        return ocTheme.bgHighlight;
      case BackgroundShade.overlay:
        return ocTheme.bgOverlay;
    }
  }
}

/// Background layer that renders a solid shade color
class _ShadeBackgroundLayer extends StatelessWidget {
  const _ShadeBackgroundLayer({required this.color});

  final Color color;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(child: Container(color: color));
  }
}

/// Background layer that renders a custom image with blur and opacity
class _ImageBackgroundLayer extends StatelessWidget {
  const _ImageBackgroundLayer({
    required this.imagePath,
    required this.opacity,
    required this.blur,
  });

  final String imagePath;
  final double opacity;
  final double blur;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Positioned.fill(
      child: Stack(
        fit: StackFit.expand,
        children: [
          // The image
          Image.file(
            File(imagePath),
            fit: BoxFit.cover,
            errorBuilder: (context, error, stackTrace) {
              // If image fails to load, show nothing
              return const SizedBox.shrink();
            },
          ),
          // Blur layer (if blur > 0)
          if (blur > 0)
            BackdropFilter(
              filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
              child: Container(color: Colors.transparent),
            ),
          // Dark overlay for readability
          Container(
            color: theme.scaffoldBackgroundColor.withValues(
              alpha: 1.0 - opacity,
            ),
          ),
        ],
      ),
    );
  }
}

/// A convenience wrapper that provides a Scaffold with the custom background
/// already set up. Use this for screens that need the background.
///
/// ```dart
/// return BackgroundScaffold(
///   appBar: AppBar(...),
///   body: YourContent(),
/// );
/// ```
class BackgroundScaffold extends ConsumerWidget {
  const BackgroundScaffold({
    super.key,
    this.appBar,
    required this.body,
    this.floatingActionButton,
    this.bottomNavigationBar,
    this.backgroundColor,
    this.extendBody = false,
    this.extendBodyBehindAppBar = false,
    this.resizeToAvoidBottomInset = true,
  });

  final PreferredSizeWidget? appBar;
  final Widget body;
  final Widget? floatingActionButton;
  final Widget? bottomNavigationBar;
  final Color? backgroundColor;
  final bool extendBody;
  final bool extendBodyBehindAppBar;
  final bool resizeToAvoidBottomInset;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appearance = ref.watch(appearanceProvider);
    final hasBackground =
        appearance.hasCustomBackground || appearance.hasCustomShade;

    return Scaffold(
      backgroundColor: backgroundColor,
      extendBody: extendBody || hasBackground,
      extendBodyBehindAppBar: extendBodyBehindAppBar || hasBackground,
      resizeToAvoidBottomInset: resizeToAvoidBottomInset,
      appBar: appBar,
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: bottomNavigationBar,
      body: hasBackground
          ? Stack(children: [const AppBackground(), body])
          : body,
    );
  }
}
