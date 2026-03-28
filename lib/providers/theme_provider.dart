import 'package:broski/theme/themes/all_themes.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Theme state containing the selected theme ID
class ThemeState {
  const ThemeState({required this.themeId, this.isLoading = false});

  /// The ID of the currently selected theme (e.g., 'opencode', 'dracula')
  final String themeId;

  /// Whether the theme is currently loading
  final bool isLoading;

  ThemeState copyWith({String? themeId, bool? isLoading}) {
    return ThemeState(
      themeId: themeId ?? this.themeId,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class ThemeNotifier extends StateNotifier<ThemeState> {
  ThemeNotifier()
    : super(const ThemeState(themeId: defaultThemeId, isLoading: true)) {
    _loadTheme();
  }

  static const _prefsKey = 'selected_theme_id';

  Future<void> _loadTheme() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedThemeId = prefs.getString(_prefsKey);

      // Verify the theme exists, fallback to default if not
      final themeExists = allThemes.any((t) => t.id == savedThemeId);
      final themeId = themeExists ? savedThemeId! : defaultThemeId;

      state = ThemeState(themeId: themeId, isLoading: false);
    } catch (e) {
      // On error, use default theme
      state = const ThemeState(themeId: defaultThemeId, isLoading: false);
    }
  }

  /// Set the current theme by ID
  Future<void> setTheme(String themeId) async {
    // Verify the theme exists
    final themeExists = allThemes.any((t) => t.id == themeId);
    if (!themeExists) return;

    state = state.copyWith(themeId: themeId);

    // Persist the selection
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_prefsKey, themeId);
    } catch (e) {
      // Ignore persistence errors
    }
  }

  /// Get the current theme info
  ThemeInfo? get currentThemeInfo {
    return allThemes.where((t) => t.id == state.themeId).firstOrNull;
  }
}

final themeProvider = StateNotifierProvider<ThemeNotifier, ThemeState>((ref) {
  return ThemeNotifier();
});

/// Convenience provider to get the current theme ID
final currentThemeIdProvider = Provider<String>((ref) {
  return ref.watch(themeProvider).themeId;
});

/// Convenience provider to get the current ThemeInfo
final currentThemeInfoProvider = Provider<ThemeInfo?>((ref) {
  final themeId = ref.watch(currentThemeIdProvider);
  return allThemes.where((t) => t.id == themeId).firstOrNull;
});

// Legacy compatibility - remove if not needed elsewhere
enum AppThemeMode { dark, black }
