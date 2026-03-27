import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// BROSKI TYPOGRAPHY SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
// UI Font:   User-selectable (default: Geist Sans). Bundled fonts use
//            fontFamily directly, Google Fonts use GoogleFonts.getFont().
// Code Font: User-selectable (default: JetBrains Mono). Same loading strategy.
// ═══════════════════════════════════════════════════════════════════════════════

/// Centralized typography factory for consistent text styles.
///
/// Font families are configurable via [setUIFont] and [setCodeFont].
/// The font provider calls these on startup and when the user changes fonts.
///
/// Usage:
/// ```dart
/// Text('Hello', style: AppTypography.h1(color: theme.text))
/// Text('code', style: AppTypography.code(color: theme.primary))
/// ```
abstract final class AppTypography {
  // ── Current font family state ──
  // Mutable statics updated by the font provider. Default to bundled fonts
  // so the app works even before the provider initializes.

  static String _uiFontFamily = 'GeistSans';
  static bool _uiFontIsAsset = true;

  static String _codeFontFamily = 'JetBrains Mono';
  static bool _codeFontIsAsset = false;

  /// The current UI font family string. Widgets that reference
  /// `AppTypography.uiFontFamily` will get the user's selected font.
  static String get uiFontFamily => _uiFontFamily;

  /// Whether the current UI font is a bundled asset or a Google Font.
  static bool get uiFontIsAsset => _uiFontIsAsset;

  /// Whether the current code font is a bundled asset or a Google Font.
  static bool get codeFontIsAsset => _codeFontIsAsset;

  /// Geist Mono — monospace variant from Vercel's Geist family.
  /// Bundled as asset (fonts/GeistMono/). Use for code-styled UI labels.
  static const monoFontFamily = 'GeistMono';

  /// Geist Pixel (Square) — pixel/retro display font from Vercel's Geist family.
  /// Bundled as asset (fonts/GeistPixel/). Use for hero headings in
  /// onboarding and splash screens — the chunky pixel aesthetic.
  static const pixelFontFamily = 'GeistPixel';

  /// The current code font family string.
  ///
  /// For Google Fonts, this also triggers font registration so that
  /// call-sites using `TextStyle(fontFamily: AppTypography.codeFontFamily)`
  /// find a registered font without needing to call `GoogleFonts.getFont()`.
  static String get codeFontFamily {
    if (!_codeFontIsAsset) {
      // Trigger registration as a side-effect — the returned TextStyle is
      // discarded but the font family is now registered with the engine.
      return GoogleFonts.getFont(_codeFontFamily).fontFamily ?? _codeFontFamily;
    }
    return _codeFontFamily;
  }

  /// Update the UI font. Called by the font provider when the user
  /// changes fonts or on app startup.
  static void setUIFont(String fontFamily, {bool isAsset = false}) {
    _uiFontFamily = fontFamily;
    _uiFontIsAsset = isAsset;
  }

  /// Update the code font. Called by the font provider when the user
  /// changes fonts or on app startup.
  static void setCodeFont(String fontFamily, {bool isAsset = false}) {
    _codeFontFamily = fontFamily;
    _codeFontIsAsset = isAsset;
  }

  // ── Internal helpers ──

  /// Creates a TextStyle using the current UI font.
  /// For bundled asset fonts, sets fontFamily directly.
  /// For Google Fonts, uses GoogleFonts.getFont() for proper loading.
  static TextStyle _uiStyle({
    required double fontSize,
    required FontWeight fontWeight,
    double? letterSpacing,
    double? height,
    Color? color,
  }) {
    if (_uiFontIsAsset) {
      return TextStyle(
        fontFamily: _uiFontFamily,
        fontSize: fontSize,
        fontWeight: fontWeight,
        letterSpacing: letterSpacing,
        height: height,
        color: color,
      );
    }
    return GoogleFonts.getFont(
      _uiFontFamily,
      fontSize: fontSize,
      fontWeight: fontWeight,
      letterSpacing: letterSpacing,
      height: height,
      color: color,
    );
  }

  /// Creates a TextStyle using the current code font.
  static TextStyle _codeStyle({
    required double fontSize,
    FontWeight fontWeight = FontWeight.w400,
    Color? color,
  }) {
    if (_codeFontIsAsset) {
      return TextStyle(
        fontFamily: _codeFontFamily,
        fontSize: fontSize,
        fontWeight: fontWeight,
        color: color,
      );
    }
    return GoogleFonts.getFont(
      _codeFontFamily,
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color,
    );
  }

  // ── Display & Headings ──

  /// 32px w700, -0.5 tracking — splash/hero text
  static TextStyle display({Color? color}) => _uiStyle(
    fontSize: 32,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.5,
    color: color,
  );

  /// 28px w700, -0.3 tracking — screen titles
  static TextStyle h1({Color? color}) => _uiStyle(
    fontSize: 28,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.3,
    color: color,
  );

  /// 22px w600, -0.2 tracking — section headings
  static TextStyle h2({Color? color}) => _uiStyle(
    fontSize: 22,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
    color: color,
  );

  /// 18px w600 — card titles, sub-section headings
  static TextStyle h3({Color? color}) =>
      _uiStyle(fontSize: 18, fontWeight: FontWeight.w600, color: color);

  // ── Body Text ──

  /// 16px w400, 1.5 height — large body text
  static TextStyle bodyLarge({Color? color}) => _uiStyle(
    fontSize: 16,
    fontWeight: FontWeight.w400,
    height: 1.5,
    color: color,
  );

  /// 15px w400, 1.5 height — standard body text
  static TextStyle body({Color? color}) => _uiStyle(
    fontSize: 15,
    fontWeight: FontWeight.w400,
    height: 1.5,
    color: color,
  );

  /// 13px w400, 1.4 height — secondary/small body text
  static TextStyle bodySmall({Color? color}) => _uiStyle(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    height: 1.4,
    color: color,
  );

  // ── Labels & Captions ──

  /// 14px w600 — button text, prominent labels
  static TextStyle labelLarge({Color? color}) =>
      _uiStyle(fontSize: 14, fontWeight: FontWeight.w600, color: color);

  /// 12px w500 — secondary labels, metadata
  static TextStyle label({Color? color}) =>
      _uiStyle(fontSize: 12, fontWeight: FontWeight.w500, color: color);

  /// 11px w500, +0.3 tracking — uppercase micro-labels
  static TextStyle labelSmall({Color? color}) => _uiStyle(
    fontSize: 11,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.3,
    color: color,
  );

  /// 11px w400 — timestamps, helper text
  static TextStyle caption({Color? color}) =>
      _uiStyle(fontSize: 11, fontWeight: FontWeight.w400, color: color);

  // ── Code (user-selectable monospace) ──

  /// 13px monospace — code blocks, terminal output, diffs
  static TextStyle code({Color? color}) =>
      _codeStyle(fontSize: 13, color: color);

  /// 11px monospace — compact code, line numbers, badges
  static TextStyle codeSmall({Color? color}) =>
      _codeStyle(fontSize: 11, color: color);

  /// 14px monospace — terminal default size
  static TextStyle codeLarge({Color? color}) =>
      _codeStyle(fontSize: 14, color: color);
}
