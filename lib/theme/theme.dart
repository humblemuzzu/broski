import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Broski app theme configuration.
///
/// Uses OpenCodeTheme extension to provide semantic color tokens
/// that match the OpenCode CLI design system.
/// Typography is user-configurable via the font provider.
class BroskiTheme {
  /// Build a ThemeData from a specific OpenCodeTheme.
  ///
  /// [uiFontFamily] overrides the font used for all text theme styles.
  /// [uiFontIsAsset] indicates whether the font is bundled (true) or a
  /// Google Font that needs [GoogleFonts.getFont] for proper loading (false).
  /// Use [isLight] to switch base theme (affects system UI colors).
  static ThemeData fromOpenCodeTheme(
    OpenCodeTheme ocTheme, {
    bool isLight = false,
    String? uiFontFamily,
    bool uiFontIsAsset = true,
  }) {
    final fontFamily = uiFontFamily ?? AppTypography.uiFontFamily;
    final isAsset = uiFontFamily != null
        ? uiFontIsAsset
        : AppTypography.uiFontIsAsset;
    final base = isLight ? ThemeData.light() : ThemeData.dark();

    // Helper: create a TextStyle with the correct font loading strategy
    TextStyle ts({
      required double fontSize,
      FontWeight? fontWeight,
      double? letterSpacing,
      double? height,
      Color? color,
    }) {
      if (isAsset) {
        return TextStyle(
          fontFamily: fontFamily,
          fontSize: fontSize,
          fontWeight: fontWeight,
          letterSpacing: letterSpacing,
          height: height,
          color: color,
        );
      }
      return GoogleFonts.getFont(
        fontFamily,
        fontSize: fontSize,
        fontWeight: fontWeight,
        letterSpacing: letterSpacing,
        height: height,
        color: color,
      );
    }

    final textTheme = base.textTheme.copyWith(
      displayLarge: ts(
        fontSize: 32,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.5,
        color: ocTheme.text,
      ),
      headlineLarge: ts(
        fontSize: 28,
        fontWeight: FontWeight.w700,
        letterSpacing: -0.3,
        color: ocTheme.text,
      ),
      headlineMedium: ts(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.2,
        color: ocTheme.text,
      ),
      headlineSmall: ts(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: ocTheme.text,
      ),
      bodyLarge: ts(fontSize: 16, color: ocTheme.text, height: 1.5),
      bodyMedium: ts(fontSize: 15, color: ocTheme.text, height: 1.5),
      bodySmall: ts(fontSize: 13, color: ocTheme.textMuted, height: 1.4),
      titleLarge: ts(
        fontSize: 20,
        fontWeight: FontWeight.w600,
        color: ocTheme.text,
      ),
      titleMedium: ts(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: ocTheme.text,
      ),
      titleSmall: ts(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: ocTheme.text,
      ),
      labelLarge: ts(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: ocTheme.text,
      ),
      labelMedium: ts(
        fontSize: 12,
        fontWeight: FontWeight.w500,
        color: ocTheme.textMuted,
      ),
      labelSmall: ts(
        fontSize: 11,
        fontWeight: FontWeight.w500,
        color: ocTheme.textMuted,
        letterSpacing: 0.3,
      ),
    );

    final buttonTextStyle = ts(fontSize: 14, fontWeight: FontWeight.w600);

    return base.copyWith(
      // Attach OpenCodeTheme as extension
      extensions: [ocTheme],

      colorScheme: isLight
          ? ColorScheme.light(
              primary: ocTheme.primary,
              secondary: ocTheme.secondary,
              tertiary: ocTheme.accent,
              error: ocTheme.error,
              surface: ocTheme.backgroundPanel,
              onPrimary: ocTheme.selectedListItemText,
              onSecondary: ocTheme.text,
              onSurface: ocTheme.text,
              onError: Colors.white,
              surfaceContainerHighest: ocTheme.backgroundElement,
            )
          : ColorScheme.dark(
              primary: ocTheme.primary,
              secondary: ocTheme.secondary,
              tertiary: ocTheme.accent,
              error: ocTheme.error,
              surface: ocTheme.backgroundPanel,
              onPrimary: ocTheme.selectedListItemText,
              onSecondary: ocTheme.text,
              onSurface: ocTheme.text,
              onError: Colors.white,
              surfaceContainerHighest: ocTheme.backgroundElement,
            ),

      scaffoldBackgroundColor: ocTheme.background,
      textTheme: textTheme,

      appBarTheme: AppBarTheme(
        backgroundColor: ocTheme.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: textTheme.titleMedium,
        iconTheme: IconThemeData(color: ocTheme.text),
      ),

      cardTheme: CardThemeData(
        color: ocTheme.backgroundPanel,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: Radii.brLg,
          side: BorderSide(color: ocTheme.borderSubtle, width: 1),
        ),
      ),

      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: ocTheme.backgroundPanel,
        border: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: ocTheme.borderSubtle, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: ocTheme.primary, width: 1.5),
        ),
        hintStyle: TextStyle(color: ocTheme.textMuted),
        contentPadding: Insets.input,
      ),

      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: ocTheme.backgroundPanel,
        selectedItemColor: ocTheme.primary,
        unselectedItemColor: ocTheme.textMuted,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),

      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: ocTheme.primary,
          foregroundColor: ocTheme.selectedListItemText,
          elevation: 0,
          padding: Insets.button,
          shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
          textStyle: buttonTextStyle,
        ),
      ),

      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: ocTheme.text,
          side: BorderSide(color: ocTheme.border),
          padding: Insets.button,
          shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
          textStyle: buttonTextStyle,
        ),
      ),

      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: ocTheme.primary,
          textStyle: buttonTextStyle,
        ),
      ),

      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(foregroundColor: ocTheme.text),
      ),

      listTileTheme: ListTileThemeData(
        tileColor: Colors.transparent,
        textColor: ocTheme.text,
        iconColor: ocTheme.textMuted,
        contentPadding: const EdgeInsets.symmetric(horizontal: Spacing.lg),
      ),

      dividerTheme: DividerThemeData(
        color: ocTheme.borderSubtle,
        thickness: 1,
        space: 1,
      ),

      dialogTheme: DialogThemeData(
        backgroundColor: ocTheme.backgroundPanel,
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: Radii.brXl),
        titleTextStyle: textTheme.titleMedium,
        contentTextStyle: textTheme.bodyMedium,
      ),

      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: ocTheme.backgroundPanel,
        modalBackgroundColor: ocTheme.backgroundPanel,
        shape: const RoundedRectangleBorder(borderRadius: Radii.sheetTop),
      ),

      snackBarTheme: SnackBarThemeData(
        backgroundColor: ocTheme.backgroundPanel,
        contentTextStyle: TextStyle(color: ocTheme.text),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
      ),

      popupMenuTheme: PopupMenuThemeData(
        color: ocTheme.backgroundMenu,
        elevation: 8,
        shape: RoundedRectangleBorder(borderRadius: Radii.brLg),
        textStyle: textTheme.bodyMedium,
      ),

      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: ocTheme.primary,
        circularTrackColor: ocTheme.borderSubtle,
      ),

      sliderTheme: SliderThemeData(
        activeTrackColor: ocTheme.primary,
        inactiveTrackColor: ocTheme.borderSubtle,
        thumbColor: ocTheme.primary,
      ),

      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return ocTheme.primary;
          }
          return ocTheme.textMuted;
        }),
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return ocTheme.primary.withValues(alpha: 0.4);
          }
          return ocTheme.borderSubtle;
        }),
      ),

      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return ocTheme.primary;
          }
          return Colors.transparent;
        }),
        checkColor: WidgetStateProperty.all(ocTheme.selectedListItemText),
        side: BorderSide(color: ocTheme.border, width: 1.5),
        shape: RoundedRectangleBorder(borderRadius: Radii.brXs),
      ),

      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return ocTheme.primary;
          }
          return ocTheme.border;
        }),
      ),

      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: ocTheme.backgroundElement,
          borderRadius: Radii.brSm,
        ),
        textStyle: TextStyle(color: ocTheme.text, fontSize: 12),
      ),

      scrollbarTheme: ScrollbarThemeData(
        thumbColor: WidgetStateProperty.all(ocTheme.border),
        radius: const Radius.circular(Radii.xs),
        thickness: WidgetStateProperty.all(4),
      ),
    );
  }

  /// Build theme from theme ID.
  ///
  /// Pass [uiFontFamily] and [uiFontIsAsset] to override the UI font.
  /// When omitted, falls back to [AppTypography.uiFontFamily] (which is
  /// kept in sync by the font provider).
  static ThemeData fromThemeId(
    String themeId, {
    String? uiFontFamily,
    bool uiFontIsAsset = true,
  }) {
    final themeInfo = getThemeInfoById(themeId);
    final theme = themeInfo?.theme ?? opencodeDarkTheme;
    final isLight = themeInfo?.isLight ?? false;
    return fromOpenCodeTheme(
      theme,
      isLight: isLight,
      uiFontFamily: uiFontFamily,
      uiFontIsAsset: uiFontIsAsset,
    );
  }

  /// Pure Black Theme (OpenCode-inspired) - Default for mobile
  /// DEPRECATED: Use fromThemeId('opencode') instead
  static ThemeData black() {
    return fromOpenCodeTheme(opencodeDarkTheme);
  }

  /// Dark Blue Theme (original) - Alternative
  /// DEPRECATED: Use fromThemeId() instead
  static ThemeData dark() {
    return fromOpenCodeTheme(opencodeDarkTheme);
  }

  /// Light theme - Clean, eye-friendly light theme for coding
  static ThemeData light() {
    return fromOpenCodeTheme(opencodeLightTheme, isLight: true);
  }
}
