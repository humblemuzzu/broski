import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'colors.dart';

class BroskiTheme {
  static ThemeData dark() {
    final base = ThemeData.dark();
    final textTheme = GoogleFonts.spaceGroteskTextTheme(base.textTheme)
        .copyWith(
          bodyMedium: GoogleFonts.spaceGrotesk(
            fontSize: 15,
            color: BroskiColors.fog,
          ),
          bodySmall: GoogleFonts.spaceGrotesk(
            fontSize: 13,
            color: BroskiColors.fog,
          ),
          labelLarge: GoogleFonts.spaceGrotesk(fontWeight: FontWeight.w600),
        );

    return base.copyWith(
      colorScheme: const ColorScheme.dark(
        primary: BroskiColors.frost,
        secondary: BroskiColors.gold,
        surface: BroskiColors.abyss,
        background: BroskiColors.midnight,
        onPrimary: Colors.white,
        onSecondary: BroskiColors.midnight,
        onSurface: BroskiColors.fog,
        onBackground: BroskiColors.fog,
        error: BroskiColors.ember,
        onError: Colors.white,
      ),
      scaffoldBackgroundColor: BroskiColors.midnight,
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: BroskiColors.abyss,
        titleTextStyle: textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w600,
          color: BroskiColors.fog,
        ),
      ),
      cardTheme: const CardThemeData(
        color: BroskiColors.abyss,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(16)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: BroskiColors.abyss,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: BroskiColors.abyss,
        selectedItemColor: BroskiColors.frost,
        unselectedItemColor: BroskiColors.fog,
      ),
    );
  }

  static ThemeData light() {
    final base = ThemeData.light();
    final textTheme = GoogleFonts.spaceGroteskTextTheme(base.textTheme)
        .copyWith(
          bodyMedium: GoogleFonts.spaceGrotesk(
            fontSize: 15,
            color: BroskiColors.ink,
          ),
          bodySmall: GoogleFonts.spaceGrotesk(
            fontSize: 13,
            color: BroskiColors.ink,
          ),
          labelLarge: GoogleFonts.spaceGrotesk(fontWeight: FontWeight.w600),
        );

    return base.copyWith(
      colorScheme: const ColorScheme.light(
        primary: BroskiColors.sky,
        secondary: BroskiColors.gold,
        surface: Colors.white,
        background: BroskiColors.paper,
        onPrimary: Colors.white,
        onSecondary: BroskiColors.ink,
        onSurface: BroskiColors.ink,
        onBackground: BroskiColors.ink,
        error: BroskiColors.ember,
        onError: Colors.white,
      ),
      scaffoldBackgroundColor: BroskiColors.paper,
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.white,
        titleTextStyle: textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w600,
          color: BroskiColors.ink,
        ),
      ),
      cardTheme: const CardThemeData(
        color: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(16)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: BroskiColors.haze,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: Colors.white,
        selectedItemColor: BroskiColors.sky,
        unselectedItemColor: BroskiColors.ink,
      ),
    );
  }
}
