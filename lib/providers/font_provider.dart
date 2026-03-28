import 'package:broski/models/font_preference.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Font state containing the user's selected UI and code fonts.
class FontState {
  const FontState({required this.preference, this.isLoading = false});

  /// The user's current font selections.
  final FontPreference preference;

  /// Whether fonts are still loading from SharedPreferences.
  final bool isLoading;

  FontState copyWith({FontPreference? preference, bool? isLoading}) {
    return FontState(
      preference: preference ?? this.preference,
      isLoading: isLoading ?? this.isLoading,
    );
  }
}

class FontNotifier extends StateNotifier<FontState> {
  FontNotifier()
    : super(const FontState(preference: FontPreference(), isLoading: true)) {
    _loadFonts();
  }

  static const _uiFontKey = 'selected_ui_font';
  static const _codeFontKey = 'selected_code_font';

  SharedPreferences? _prefs;

  Future<SharedPreferences> get _sharedPrefs async =>
      _prefs ??= await SharedPreferences.getInstance();

  /// Sync AppTypography statics so every widget sees the correct font
  /// immediately, even before the next ThemeData rebuild.
  static void _syncTypography(FontPreference pref) {
    AppTypography.setUIFont(
      pref.uiFont.fontFamily,
      isAsset: pref.uiFont.isAsset,
    );
    AppTypography.setCodeFont(
      pref.codeFont.fontFamily,
      isAsset: pref.codeFont.isAsset,
    );
  }

  Future<void> _loadFonts() async {
    try {
      final prefs = await _sharedPrefs;
      final savedUIFont = prefs.getString(_uiFontKey);
      final savedCodeFont = prefs.getString(_codeFontKey);

      final preference = FontPreference(
        uiFont: savedUIFont != null
            ? UIFont.fromFontFamily(savedUIFont)
            : UIFont.defaultFont,
        codeFont: savedCodeFont != null
            ? CodeFont.fromFontFamily(savedCodeFont)
            : CodeFont.defaultFont,
      );

      _syncTypography(preference);
      state = FontState(preference: preference, isLoading: false);
    } catch (e) {
      // On error, use default fonts
      state = const FontState(preference: FontPreference(), isLoading: false);
    }
  }

  /// Set the current UI font.
  Future<void> setUIFont(UIFont font) async {
    final newPref = state.preference.copyWith(uiFont: font);
    _syncTypography(newPref);
    state = state.copyWith(preference: newPref);

    // Persist the selection
    try {
      (await _sharedPrefs).setString(_uiFontKey, font.fontFamily);
    } catch (e) {
      // Ignore persistence errors
    }
  }

  /// Set the current code font.
  Future<void> setCodeFont(CodeFont font) async {
    final newPref = state.preference.copyWith(codeFont: font);
    _syncTypography(newPref);
    state = state.copyWith(preference: newPref);

    // Persist the selection
    try {
      (await _sharedPrefs).setString(_codeFontKey, font.fontFamily);
    } catch (e) {
      // Ignore persistence errors
    }
  }
}

final fontProvider = StateNotifierProvider<FontNotifier, FontState>((ref) {
  return FontNotifier();
});

/// Convenience: current UI font family string.
final currentUIFontFamilyProvider = Provider<String>((ref) {
  return ref.watch(fontProvider).preference.uiFont.fontFamily;
});

/// Convenience: current code font family string.
final currentCodeFontFamilyProvider = Provider<String>((ref) {
  return ref.watch(fontProvider).preference.codeFont.fontFamily;
});

/// Convenience: current UI font enum.
final currentUIFontProvider = Provider<UIFont>((ref) {
  return ref.watch(fontProvider).preference.uiFont;
});

/// Convenience: current code font enum.
final currentCodeFontProvider = Provider<CodeFont>((ref) {
  return ref.watch(fontProvider).preference.codeFont;
});
