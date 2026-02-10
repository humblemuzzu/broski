import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

// ═══════════════════════════════════════════════════════════════════════════════
// BROSKI TYPOGRAPHY SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════
// UI Font:   Geist Sans — sharp, geometric, developer-native (by Vercel)
//            Bundled as asset (fonts/GeistSans/)
// Code Font: JetBrains Mono — purpose-built for code readability
//            Via google_fonts package
// ═══════════════════════════════════════════════════════════════════════════════

/// Centralized typography factory for consistent text styles.
///
/// Usage:
/// ```dart
/// Text('Hello', style: AppTypography.h1(color: theme.text))
/// Text('code', style: AppTypography.code(color: theme.primary))
/// ```
abstract final class AppTypography {
  static const _fontFamily = 'GeistSans';
  static const uiFontFamily = 'GeistSans';

  /// Geist Mono — monospace variant from Vercel's Geist family.
  /// Bundled as asset (fonts/GeistMono/). Use for code-styled UI labels.
  static const monoFontFamily = 'GeistMono';

  /// Geist Pixel (Square) — pixel/retro display font from Vercel's Geist family.
  /// Bundled as asset (fonts/GeistPixel/). Use for hero headings in
  /// onboarding and splash screens — the chunky pixel aesthetic.
  static const pixelFontFamily = 'GeistPixel';

  /// Cached code font family name (JetBrains Mono via google_fonts).
  /// Use this when you need just the fontFamily string inside a TextStyle
  /// that has other properties you want to keep.
  static String get codeFontFamily =>
      GoogleFonts.jetBrainsMono().fontFamily ?? 'JetBrains Mono';

  // ── Display & Headings ──

  /// 32px w700, -0.5 tracking — splash/hero text
  static TextStyle display({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 32,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.5,
        color: color,
      );

  /// 28px w700, -0.3 tracking — screen titles
  static TextStyle h1({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 28,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
        color: color,
      );

  /// 22px w600, -0.2 tracking — section headings
  static TextStyle h2({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 22,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.2,
        color: color,
      );

  /// 18px w600 — card titles, sub-section headings
  static TextStyle h3({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: color,
      );

  // ── Body Text ──

  /// 16px w400, 1.5 height — large body text
  static TextStyle bodyLarge({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 16,
        fontWeight: FontWeight.w400,
        height: 1.5,
        color: color,
      );

  /// 15px w400, 1.5 height — standard body text
  static TextStyle body({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 15,
        fontWeight: FontWeight.w400,
        height: 1.5,
        color: color,
      );

  /// 13px w400, 1.4 height — secondary/small body text
  static TextStyle bodySmall({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 13,
        fontWeight: FontWeight.w400,
        height: 1.4,
        color: color,
      );

  // ── Labels & Captions ──

  /// 14px w600 — button text, prominent labels
  static TextStyle labelLarge({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: color,
      );

  /// 12px w500 — secondary labels, metadata
  static TextStyle label({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 12,
        fontWeight: FontWeight.w500,
        color: color,
      );

  /// 11px w500, +0.3 tracking — uppercase micro-labels
  static TextStyle labelSmall({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 11,
        fontWeight: FontWeight.w500,
        letterSpacing: 0.3,
        color: color,
      );

  /// 11px w400 — timestamps, helper text
  static TextStyle caption({Color? color}) => TextStyle(
        fontFamily: _fontFamily,
        fontSize: 11,
        fontWeight: FontWeight.w400,
        color: color,
      );

  // ── Code (JetBrains Mono) ──

  /// 13px monospace — code blocks, terminal output, diffs
  static TextStyle code({Color? color}) => GoogleFonts.jetBrainsMono(
        fontSize: 13,
        fontWeight: FontWeight.w400,
        color: color,
      );

  /// 11px monospace — compact code, line numbers, badges
  static TextStyle codeSmall({Color? color}) => GoogleFonts.jetBrainsMono(
        fontSize: 11,
        fontWeight: FontWeight.w400,
        color: color,
      );

  /// 14px monospace — terminal default size
  static TextStyle codeLarge({Color? color}) => GoogleFonts.jetBrainsMono(
        fontSize: 14,
        fontWeight: FontWeight.w400,
        color: color,
      );
}
