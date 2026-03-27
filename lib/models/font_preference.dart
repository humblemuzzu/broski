/// Font preference models for customizing UI and code fonts.
///
/// Each enum value carries its own metadata (font family string, display name,
/// description, and whether it's a bundled asset or loaded via google_fonts).
/// [FontPreference] holds the user's current selections and serializes via
/// font-family strings so saved prefs survive enum reordering.
library;

/// Developer-favorite sans-serif fonts for the app UI.
enum UIFont {
  geistSans(
    fontFamily: 'GeistSans',
    displayName: 'Geist Sans',
    description: 'Vercel — clean, geometric',
    isAsset: true,
  ),
  inter(
    fontFamily: 'Inter',
    displayName: 'Inter',
    description: 'Most popular UI font in dev tools',
    isAsset: false,
  ),
  ibmPlexSans(
    fontFamily: 'IBM Plex Sans',
    displayName: 'IBM Plex Sans',
    description: 'Clean, technical, IBM-designed',
    isAsset: false,
  ),
  spaceGrotesk(
    fontFamily: 'Space Grotesk',
    displayName: 'Space Grotesk',
    description: 'Geometric, techy vibe',
    isAsset: false,
  ),
  dmSans(
    fontFamily: 'DM Sans',
    displayName: 'DM Sans',
    description: 'Clean, neutral, versatile',
    isAsset: false,
  ),
  outfit(
    fontFamily: 'Outfit',
    displayName: 'Outfit',
    description: 'Modern, geometric sans-serif',
    isAsset: false,
  ),
  plusJakartaSans(
    fontFamily: 'Plus Jakarta Sans',
    displayName: 'Plus Jakarta Sans',
    description: 'Trendy, slightly rounded',
    isAsset: false,
  ),
  manrope(
    fontFamily: 'Manrope',
    displayName: 'Manrope',
    description: 'Semi-rounded, friendly',
    isAsset: false,
  ),
  sourceSans3(
    fontFamily: 'Source Sans 3',
    displayName: 'Source Sans 3',
    description: 'Adobe — professional workhorse',
    isAsset: false,
  ),
  nunitoSans(
    fontFamily: 'Nunito Sans',
    displayName: 'Nunito Sans',
    description: 'Rounded, approachable',
    isAsset: false,
  ),
  rubik(
    fontFamily: 'Rubik',
    displayName: 'Rubik',
    description: 'Slightly rounded, warm',
    isAsset: false,
  ),
  workSans(
    fontFamily: 'Work Sans',
    displayName: 'Work Sans',
    description: 'Optimized for screens',
    isAsset: false,
  );

  const UIFont({
    required this.fontFamily,
    required this.displayName,
    required this.description,
    required this.isAsset,
  });

  /// The font family string Flutter uses to resolve the typeface.
  final String fontFamily;

  /// Human-readable name shown in the font picker UI.
  final String displayName;

  /// Short subtitle describing the font's character.
  final String description;

  /// Whether the font is bundled as an app asset (`true`) or loaded at
  /// runtime via google_fonts (`false`).
  final bool isAsset;

  /// The default UI font.
  static UIFont get defaultFont => UIFont.geistSans;

  /// Looks up a [UIFont] by its [fontFamily] string.
  /// Returns [defaultFont] if no match is found.
  static UIFont fromFontFamily(String family) {
    for (final font in UIFont.values) {
      if (font.fontFamily == family) return font;
    }
    return defaultFont;
  }
}

/// Developer-favorite monospace fonts for code display.
enum CodeFont {
  jetBrainsMono(
    fontFamily: 'JetBrains Mono',
    displayName: 'JetBrains Mono',
    description: 'Sharp, clean, best all-rounder',
    isAsset: false,
  ),
  geistMono(
    fontFamily: 'GeistMono',
    displayName: 'Geist Mono',
    description: 'Vercel — ultra minimal & modern',
    isAsset: true,
  ),
  firaCode(
    fontFamily: 'Fira Code',
    displayName: 'Fira Code',
    description: 'The OG ligature font — wide & readable',
    isAsset: false,
  ),
  sourceCodePro(
    fontFamily: 'Source Code Pro',
    displayName: 'Source Code Pro',
    description: 'Adobe — crisp & neutral',
    isAsset: false,
  ),
  victorMono(
    fontFamily: 'Victor Mono',
    displayName: 'Victor Mono',
    description: 'Thin elegant, cursive italics',
    isAsset: false,
  ),
  inconsolata(
    fontFamily: 'Inconsolata',
    displayName: 'Inconsolata',
    description: 'Classic, narrow, clean',
    isAsset: false,
  ),
  ubuntuMono(
    fontFamily: 'Ubuntu Mono',
    displayName: 'Ubuntu Mono',
    description: 'Canonical — friendly & distinct',
    isAsset: false,
  ),
  robotoMono(
    fontFamily: 'Roboto Mono',
    displayName: 'Roboto Mono',
    description: 'Google — balanced, familiar',
    isAsset: false,
  ),
  spaceMono(
    fontFamily: 'Space Mono',
    displayName: 'Space Mono',
    description: 'Retro-futuristic, editorial',
    isAsset: false,
  ),
  ibmPlexMono(
    fontFamily: 'IBM Plex Mono',
    displayName: 'IBM Plex Mono',
    description: 'IBM — technical, precise',
    isAsset: false,
  );

  const CodeFont({
    required this.fontFamily,
    required this.displayName,
    required this.description,
    required this.isAsset,
  });

  /// The font family string Flutter uses to resolve the typeface.
  final String fontFamily;

  /// Human-readable name shown in the font picker UI.
  final String displayName;

  /// Short subtitle describing the font's character.
  final String description;

  /// Whether the font is bundled as an app asset (`true`) or loaded at
  /// runtime via google_fonts (`false`).
  final bool isAsset;

  /// The default code font.
  static CodeFont get defaultFont => CodeFont.jetBrainsMono;

  /// Looks up a [CodeFont] by its [fontFamily] string.
  /// Returns [defaultFont] if no match is found.
  static CodeFont fromFontFamily(String family) {
    for (final font in CodeFont.values) {
      if (font.fontFamily == family) return font;
    }
    return defaultFont;
  }
}

/// Holds the user's selected UI and code fonts.
///
/// Serializes using [fontFamily] strings rather than enum names so that
/// persisted preferences survive enum value renames or reordering.
class FontPreference {
  final UIFont uiFont;
  final CodeFont codeFont;

  const FontPreference({
    this.uiFont = UIFont.geistSans,
    this.codeFont = CodeFont.jetBrainsMono,
  });

  FontPreference copyWith({UIFont? uiFont, CodeFont? codeFont}) {
    return FontPreference(
      uiFont: uiFont ?? this.uiFont,
      codeFont: codeFont ?? this.codeFont,
    );
  }

  Map<String, dynamic> toJson() => {
    'uiFont': uiFont.fontFamily,
    'codeFont': codeFont.fontFamily,
  };

  factory FontPreference.fromJson(Map<String, dynamic> json) {
    return FontPreference(
      uiFont: UIFont.fromFontFamily(json['uiFont'] as String? ?? ''),
      codeFont: CodeFont.fromFontFamily(json['codeFont'] as String? ?? ''),
    );
  }
}
