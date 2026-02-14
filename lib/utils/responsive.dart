import 'package:flutter/material.dart';

import '../theme/design_tokens.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSIVE LAYOUT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════
// Centralized breakpoint helpers for iPhone/iPad adaptation.
// iPhone code paths are NEVER modified — all helpers return iPhone-appropriate
// defaults. iPad adjustments only activate when screen width > 600pt.
// ═══════════════════════════════════════════════════════════════════════════════

/// Content width presets for iPad layouts.
/// On iPhone, all presets effectively mean "no constraint" (infinity).
enum ContentWidth {
  /// 500pt — Auth, focused single-column content, dialogs
  narrow,

  /// 600pt — Onboarding pages, forms, centered content
  medium,

  /// 700pt — Settings, lists, session cards
  standard,

  /// 800pt — Chat, browse, data-rich screens
  wide,

  /// No max-width constraint — Terminal, full-bleed content
  unlimited,
}

/// Responsive layout helpers.
///
/// **iPhone guarantee: these helpers NEVER alter iPhone layout.**
/// Every method returns the existing iPhone value when width ≤ 600pt.
class Responsive {
  Responsive._(); // Non-instantiable

  // ── Breakpoint ──

  /// `true` on iPad. All iPads are ≥ 744pt wide in portrait.
  /// Uses `MediaQuery.sizeOf` (efficient — only rebuilds on size changes).
  static bool isTablet(BuildContext context) =>
      MediaQuery.sizeOf(context).width > 600;

  // ── Content sizing ──

  /// Max content width for the given [type].
  /// iPhone → `double.infinity` (no constraint).
  /// iPad → proportional to screen width so content scales with device size.
  ///
  /// Examples (portrait):
  ///   iPad mini (744pt):   standard ≈ 660, wide ≈ 700
  ///   iPad Air  (820pt):   standard ≈ 700, wide ≈ 750
  ///   iPad Pro 11" (834pt): standard ≈ 710, wide ≈ 760
  ///   iPad Pro 13" (1024pt): standard ≈ 880, wide ≈ 940
  static double maxWidth(
    BuildContext context, [
    ContentWidth type = ContentWidth.standard,
  ]) {
    if (!isTablet(context)) return double.infinity;
    final w = MediaQuery.sizeOf(context).width;
    switch (type) {
      case ContentWidth.narrow:
        // Auth, dialogs — intentionally focused / centered
        return (w * 0.58).clamp(480.0, 620.0);
      case ContentWidth.medium:
        // Onboarding, forms
        return (w * 0.68).clamp(540.0, 720.0);
      case ContentWidth.standard:
        // Settings, lists, sessions, projects — main content
        return (w * 0.86).clamp(660.0, 980.0);
      case ContentWidth.wide:
        // Chat, browse — maximize usable space
        return (w * 0.92).clamp(700.0, 1100.0);
      case ContentWidth.unlimited:
        return double.infinity;
    }
  }

  // ── Padding ──

  /// Screen-level horizontal padding.
  /// iPhone: 20pt (existing [Insets.screenH]). iPad: 40pt.
  static EdgeInsets screenPadding(BuildContext context) {
    if (!isTablet(context)) return Insets.screenH;
    return const EdgeInsets.symmetric(horizontal: 40);
  }

  // ── Grid ──

  /// Grid column count for card/project layouts.
  /// iPhone: 1. iPad: 2.
  static int gridColumns(BuildContext context) => isTablet(context) ? 2 : 1;

  // ── Navigation ──

  /// Horizontal margin that centers a nav bar on iPad.
  /// Target width is ~68% of screen (capped at 720pt).
  /// iPhone: returns zero (nav bar uses its own existing margins).
  static double navBarHorizontalMargin(BuildContext context) {
    if (!isTablet(context)) return 0;
    final screenWidth = MediaQuery.sizeOf(context).width;
    final targetWidth = (screenWidth * 0.68).clamp(540.0, 720.0);
    return ((screenWidth - targetWidth) / 2).clamp(20.0, double.infinity);
  }

  /// Horizontal padding inside list items / cards on iPad.
  /// iPhone: 0 (existing padding is sufficient). iPad: 12pt extra per side.
  static EdgeInsets listItemExtraPadding(BuildContext context) {
    if (!isTablet(context)) return EdgeInsets.zero;
    return const EdgeInsets.symmetric(horizontal: 12);
  }

  /// Bottom sheet max width on iPad. Keeps sheets from stretching edge-to-edge.
  /// Scales with screen width (≈78% of screen, capped at 880pt).
  static BoxConstraints? sheetConstraints(BuildContext context) {
    if (!isTablet(context)) return null;
    final w = MediaQuery.sizeOf(context).width;
    final sheetMax = (w * 0.78).clamp(600.0, 880.0);
    return BoxConstraints(maxWidth: sheetMax);
  }

  /// Onboarding visual scale factor.
  /// iPhone: 1.0. iPad: ~1.3 (bigger circles, icons, etc.)
  static double visualScale(BuildContext context) =>
      isTablet(context) ? 1.3 : 1.0;

  // ── Onboarding / full-screen pages ──

  /// Horizontal padding for onboarding / auth / full-bleed pages.
  /// iPhone: returns [fallback] (page's own padding). iPad: ~12% of width.
  static double onboardingHPadding(BuildContext context, double fallback) {
    if (!isTablet(context)) return fallback;
    final w = MediaQuery.sizeOf(context).width;
    return (w * 0.12).clamp(60.0, 160.0);
  }

  /// Max width for action buttons on iPad (sign-in, get started, etc.)
  /// iPhone: double.infinity (fill available width). iPad: 420pt.
  static double buttonMaxWidth(BuildContext context) =>
      isTablet(context) ? 420 : double.infinity;

  /// Font size scale for hero/title text on iPad.
  /// iPhone: 1.0. iPad: 1.2.
  static double titleScale(BuildContext context) =>
      isTablet(context) ? 1.2 : 1.0;
}
