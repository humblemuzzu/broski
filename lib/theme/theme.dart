import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'colors.dart';

class BroskiTheme {
  // Pure Black Theme (OpenCode-inspired)
  static ThemeData black() {
    final base = ThemeData.dark();
    final textTheme = GoogleFonts.spaceGroteskTextTheme(base.textTheme)
        .copyWith(
          bodyMedium: GoogleFonts.spaceGrotesk(
            fontSize: 15,
            color: const Color(0xFFE4E4E7), // Light gray text
          ),
          bodySmall: GoogleFonts.spaceGrotesk(
            fontSize: 13,
            color: const Color(0xFF9CA3AF), // Muted gray
          ),
          labelLarge: GoogleFonts.spaceGrotesk(fontWeight: FontWeight.w600),
        );

    return base.copyWith(
      colorScheme: const ColorScheme.dark(
        primary: Color(0xFF3B82F6), // Blue accent
        secondary: Color(0xFF8B5CF6), // Purple accent
        surface: Color(0xFF1C1C1E), // Darker card color (like settings)
        surfaceContainerHighest: Color(0xFF2C2C2E), // Lighter surface
        onPrimary: Colors.white,
        onSecondary: Colors.white,
        onSurface: Color(0xFFE4E4E7), // Light text
        error: Color(0xFFEF4444),
        onError: Colors.white,
      ),
      scaffoldBackgroundColor: Colors.black, // Pure black
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.black,
        elevation: 0,
        titleTextStyle: textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w600,
          color: const Color(0xFFE4E4E7),
        ),
      ),
      cardTheme: const CardThemeData(
        color: Color(0xFF1C1C1E),
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(16)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF1C1C1E),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: Color(0xFF1C1C1E),
        selectedItemColor: Color(0xFF3B82F6),
        unselectedItemColor: Color(0xFF71717A),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF3B82F6),
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: const Color(0xFFE4E4E7),
          side: const BorderSide(color: Color(0xFF71717A)),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      listTileTheme: const ListTileThemeData(
        tileColor: Color(0xFF1C1C1E),
        textColor: Color(0xFFE4E4E7),
        iconColor: Color(0xFF71717A),
      ),
    );
  }

  // Dark Blue Theme (original)
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
        onPrimary: Colors.white,
        onSecondary: BroskiColors.midnight,
        onSurface: BroskiColors.fog,
        error: BroskiColors.ember,
        onError: Colors.white,
      ),
      scaffoldBackgroundColor: BroskiColors.midnight,
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: BroskiColors.abyss,
        elevation: 0,
        titleTextStyle: textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w600,
          color: BroskiColors.fog,
        ),
      ),
      cardTheme: const CardThemeData(
        color: BroskiColors.abyss,
        elevation: 0,
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
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: BroskiColors.frost,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: BroskiColors.fog,
          side: const BorderSide(color: BroskiColors.fog),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      listTileTheme: const ListTileThemeData(
        tileColor: BroskiColors.abyss,
        textColor: BroskiColors.fog,
        iconColor: BroskiColors.fog,
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
        onPrimary: Colors.white,
        onSecondary: BroskiColors.ink,
        onSurface: BroskiColors.ink,
        error: BroskiColors.ember,
        onError: Colors.white,
      ),
      scaffoldBackgroundColor: BroskiColors.paper,
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        backgroundColor: Colors.white,
        elevation: 0,
        titleTextStyle: textTheme.titleLarge?.copyWith(
          fontWeight: FontWeight.w600,
          color: BroskiColors.ink,
        ),
      ),
      cardTheme: const CardThemeData(
        color: Colors.white,
        elevation: 0,
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
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: BroskiColors.sky,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: BroskiColors.ink,
          side: const BorderSide(color: BroskiColors.ink),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
        ),
      ),
      listTileTheme: const ListTileThemeData(
        tileColor: Colors.white,
        textColor: BroskiColors.ink,
        iconColor: BroskiColors.ink,
      ),
    );
  }
}
