import 'package:flutter/material.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// BROSKI DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════════════════
// Spacing: 4pt grid system
// Radius: Graduated scale matching component hierarchy
// Insets: Common EdgeInsets presets for consistency
// ═══════════════════════════════════════════════════════════════════════════════

/// 4-point spacing scale used throughout the app.
abstract final class Spacing {
  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double xxxl = 32;
}

/// Border radius scale with pre-built [BorderRadius] constants.
abstract final class Radii {
  // Raw values
  static const double none = 0;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 20;
  static const double xxl = 24;
  static const double full = 999;

  // Pre-built BorderRadius (use these in widgets)
  static final brNone = BorderRadius.circular(none);
  static final brXs = BorderRadius.circular(xs);
  static final brSm = BorderRadius.circular(sm);
  static final brMd = BorderRadius.circular(md);
  static final brLg = BorderRadius.circular(lg);
  static final brXl = BorderRadius.circular(xl);
  static final brXxl = BorderRadius.circular(xxl);
  static final brFull = BorderRadius.circular(full);

  // Bottom sheet top radius
  static const sheetTop = BorderRadius.vertical(top: Radius.circular(20));
}

/// Common [EdgeInsets] presets for layout consistency.
abstract final class Insets {
  // Screen-level padding
  static const screenH = EdgeInsets.symmetric(horizontal: 20);
  static const screenV = EdgeInsets.symmetric(vertical: 16);
  static const screen = EdgeInsets.all(16);

  // Card/panel padding
  static const card = EdgeInsets.all(16);
  static const cardSm = EdgeInsets.all(12);
  static const cardXs = EdgeInsets.all(8);
  static const cardH = EdgeInsets.symmetric(horizontal: 12);
  static const cardV = EdgeInsets.symmetric(vertical: 12);

  // Chip padding
  static const chip = EdgeInsets.symmetric(horizontal: 8, vertical: 4);
  static const chipH = EdgeInsets.symmetric(horizontal: 8);
  static const chipV = EdgeInsets.symmetric(vertical: 4);

  // Section padding (horizontal + vertical)
  static const section = EdgeInsets.symmetric(horizontal: 16, vertical: 12);

  // List item padding
  static const listItem = EdgeInsets.symmetric(horizontal: 16, vertical: 12);
  static const listItemDense = EdgeInsets.symmetric(horizontal: 16, vertical: 8);

  // Button padding
  static const button = EdgeInsets.symmetric(horizontal: 24, vertical: 14);
  static const buttonSm = EdgeInsets.symmetric(horizontal: 16, vertical: 10);

  // Input field content padding
  static const input = EdgeInsets.symmetric(horizontal: 16, vertical: 14);
  static const inputH = EdgeInsets.symmetric(horizontal: 12);

  // Additional common patterns
  static const cardLg = EdgeInsets.all(24);
  static const cardMd = EdgeInsets.all(14);
  static const screenAll = EdgeInsets.all(20);
  static const xxxl = EdgeInsets.all(32);

  // Directional
  static const bottomSm = EdgeInsets.only(bottom: 8);
  static const bottomMd = EdgeInsets.only(bottom: 12);
  static const topSm = EdgeInsets.only(top: 8);
}
