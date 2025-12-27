import 'dart:convert';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:path_provider/path_provider.dart';
import 'package:path/path.dart' as p;

import '../services/storage_service.dart';
import '../theme/tool_style.dart';
import 'service_providers.dart';

/// Background shade options from theme
enum BackgroundShade {
  none, // Use default theme background
  deep,
  base,
  raised,
  hover,
  active,
  highlight,
  overlay,
}

/// Screen identifiers for per-screen background control
class AppScreen {
  static const String chat = 'chat';
  static const String projects = 'projects';
  static const String browse = 'browse';
  static const String sessions = 'sessions';
  static const String settings = 'settings';

  static const List<String> all = [chat, projects, browse, sessions, settings];

  static String displayName(String screen) {
    switch (screen) {
      case chat:
        return 'Chat';
      case projects:
        return 'Projects';
      case browse:
        return 'Browse';
      case sessions:
        return 'Sessions';
      case settings:
        return 'Settings';
      default:
        return screen;
    }
  }
}

/// Appearance settings state
class AppearanceSettings {
  const AppearanceSettings({
    this.iconPack = IconPack.material,
    this.useToolColors = true,
    this.showToolBorders = true,
    this.cardBorderRadius = 12.0,
    this.compactMode = false,
    this.customBackgroundPath,
    this.backgroundOpacity = 0.15,
    this.backgroundBlur = 0.0,
    this.selectedShade = BackgroundShade.none,
    this.enabledScreens = const {},
  });

  /// Current icon pack for tool icons
  final IconPack iconPack;

  /// Whether to use tool-specific colors (vs muted gray)
  final bool useToolColors;

  /// Whether to show colored borders on tool cards
  final bool showToolBorders;

  /// Border radius for tool cards (8-20)
  final double cardBorderRadius;

  /// Compact mode - smaller cards and tighter spacing
  final bool compactMode;

  /// Path to custom background image (null = use theme default)
  final String? customBackgroundPath;

  /// Background image opacity (0.0 - 1.0)
  final double backgroundOpacity;

  /// Background blur amount (0.0 - 20.0)
  final double backgroundBlur;

  /// Selected background shade (when no custom image is set)
  final BackgroundShade selectedShade;

  /// Set of screen identifiers where custom background/shade is enabled
  /// Empty set = enabled everywhere (default behavior)
  final Set<String> enabledScreens;

  /// Check if custom background image is set
  bool get hasCustomBackground =>
      customBackgroundPath != null && customBackgroundPath!.isNotEmpty;

  /// Check if a custom shade is selected (not none)
  bool get hasCustomShade => selectedShade != BackgroundShade.none;

  /// Check if background should show on a specific screen
  bool isEnabledForScreen(String screen) {
    // If no screens specified, enabled everywhere
    if (enabledScreens.isEmpty) return true;
    return enabledScreens.contains(screen);
  }

  AppearanceSettings copyWith({
    IconPack? iconPack,
    bool? useToolColors,
    bool? showToolBorders,
    double? cardBorderRadius,
    bool? compactMode,
    String? customBackgroundPath,
    bool clearBackground = false,
    double? backgroundOpacity,
    double? backgroundBlur,
    BackgroundShade? selectedShade,
    Set<String>? enabledScreens,
  }) {
    return AppearanceSettings(
      iconPack: iconPack ?? this.iconPack,
      useToolColors: useToolColors ?? this.useToolColors,
      showToolBorders: showToolBorders ?? this.showToolBorders,
      cardBorderRadius: cardBorderRadius ?? this.cardBorderRadius,
      compactMode: compactMode ?? this.compactMode,
      customBackgroundPath: clearBackground
          ? null
          : (customBackgroundPath ?? this.customBackgroundPath),
      backgroundOpacity: backgroundOpacity ?? this.backgroundOpacity,
      backgroundBlur: backgroundBlur ?? this.backgroundBlur,
      selectedShade: selectedShade ?? this.selectedShade,
      enabledScreens: enabledScreens ?? this.enabledScreens,
    );
  }

  /// Convert to map for storage
  Map<String, dynamic> toMap() {
    return {
      'iconPack': iconPack.index,
      'useToolColors': useToolColors,
      'showToolBorders': showToolBorders,
      'cardBorderRadius': cardBorderRadius,
      'compactMode': compactMode,
      'customBackgroundPath': customBackgroundPath,
      'backgroundOpacity': backgroundOpacity,
      'backgroundBlur': backgroundBlur,
      'selectedShade': selectedShade.index,
      'enabledScreens': enabledScreens.toList(),
    };
  }

  /// Create from map
  factory AppearanceSettings.fromMap(Map<String, dynamic> map) {
    final enabledScreensList = map['enabledScreens'] as List<dynamic>?;
    return AppearanceSettings(
      iconPack: IconPack.values[map['iconPack'] as int? ?? 0],
      useToolColors: map['useToolColors'] as bool? ?? true,
      showToolBorders: map['showToolBorders'] as bool? ?? true,
      cardBorderRadius: (map['cardBorderRadius'] as num?)?.toDouble() ?? 12.0,
      compactMode: map['compactMode'] as bool? ?? false,
      customBackgroundPath: map['customBackgroundPath'] as String?,
      backgroundOpacity: (map['backgroundOpacity'] as num?)?.toDouble() ?? 0.15,
      backgroundBlur: (map['backgroundBlur'] as num?)?.toDouble() ?? 0.0,
      selectedShade: BackgroundShade.values[map['selectedShade'] as int? ?? 0],
      enabledScreens: enabledScreensList != null
          ? Set<String>.from(enabledScreensList.cast<String>())
          : const {},
    );
  }
}

/// Appearance settings notifier
class AppearanceNotifier extends StateNotifier<AppearanceSettings> {
  AppearanceNotifier(this._storage) : super(const AppearanceSettings()) {
    _loadSettings();
  }

  final StorageService _storage;
  static const _storageKey = 'appearance_settings';

  /// Load settings from storage
  Future<void> _loadSettings() async {
    final raw = await _storage.getString(_storageKey);
    if (raw != null) {
      try {
        final map = jsonDecode(raw) as Map<String, dynamic>;
        state = AppearanceSettings.fromMap(map);
        // Sync icon pack with ToolStyle
        ToolStyle.setIconPack(state.iconPack);
      } catch (_) {
        // Invalid JSON, use defaults
      }
    }
  }

  /// Save settings to storage
  Future<void> _saveSettings() async {
    final json = jsonEncode(state.toMap());
    await _storage.setString(_storageKey, json);
  }

  /// Get the app's background images directory
  Future<Directory> _getBackgroundDir() async {
    final appDir = await getApplicationDocumentsDirectory();
    final bgDir = Directory(p.join(appDir.path, 'backgrounds'));
    if (!await bgDir.exists()) {
      await bgDir.create(recursive: true);
    }
    return bgDir;
  }

  /// Set icon pack
  Future<void> setIconPack(IconPack pack) async {
    state = state.copyWith(iconPack: pack);
    ToolStyle.setIconPack(pack);
    await _saveSettings();
  }

  /// Toggle tool colors
  Future<void> setUseToolColors(bool value) async {
    state = state.copyWith(useToolColors: value);
    await _saveSettings();
  }

  /// Toggle tool borders
  Future<void> setShowToolBorders(bool value) async {
    state = state.copyWith(showToolBorders: value);
    await _saveSettings();
  }

  /// Set card border radius
  Future<void> setCardBorderRadius(double value) async {
    state = state.copyWith(cardBorderRadius: value.clamp(4.0, 24.0));
    await _saveSettings();
  }

  /// Toggle compact mode
  Future<void> setCompactMode(bool value) async {
    state = state.copyWith(compactMode: value);
    await _saveSettings();
  }

  /// Pick and set custom background image
  Future<bool> pickBackgroundImage() async {
    try {
      final picker = ImagePicker();
      final XFile? image = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 2000, // Limit size for performance
        maxHeight: 4000,
        imageQuality: 85,
      );

      if (image == null) return false;

      // Save to app documents directory
      final bgDir = await _getBackgroundDir();
      final fileName =
          'bg_${DateTime.now().millisecondsSinceEpoch}${p.extension(image.path)}';
      final savedPath = p.join(bgDir.path, fileName);

      // Copy the image to our directory
      final bytes = await image.readAsBytes();
      final file = File(savedPath);
      await file.writeAsBytes(bytes);

      // Delete old background if exists
      if (state.customBackgroundPath != null) {
        final oldFile = File(state.customBackgroundPath!);
        if (await oldFile.exists()) {
          await oldFile.delete();
        }
      }

      state = state.copyWith(customBackgroundPath: savedPath);
      await _saveSettings();
      return true;
    } catch (e) {
      return false;
    }
  }

  /// Clear custom background
  Future<void> clearBackground() async {
    // Delete the file if it exists
    if (state.customBackgroundPath != null) {
      try {
        final file = File(state.customBackgroundPath!);
        if (await file.exists()) {
          await file.delete();
        }
      } catch (_) {}
    }

    state = state.copyWith(clearBackground: true);
    await _saveSettings();
  }

  /// Set background opacity
  Future<void> setBackgroundOpacity(double value) async {
    state = state.copyWith(backgroundOpacity: value.clamp(0.05, 0.5));
    await _saveSettings();
  }

  /// Set background blur
  Future<void> setBackgroundBlur(double value) async {
    state = state.copyWith(backgroundBlur: value.clamp(0.0, 20.0));
    await _saveSettings();
  }

  /// Set selected background shade
  Future<void> setSelectedShade(BackgroundShade shade) async {
    state = state.copyWith(selectedShade: shade);
    await _saveSettings();
  }

  /// Toggle a screen's background enabled state
  Future<void> toggleScreenEnabled(String screen) async {
    final newSet = Set<String>.from(state.enabledScreens);
    if (newSet.contains(screen)) {
      newSet.remove(screen);
    } else {
      newSet.add(screen);
    }
    state = state.copyWith(enabledScreens: newSet);
    await _saveSettings();
  }

  /// Set all screens enabled or disabled
  Future<void> setAllScreensEnabled(bool enabled) async {
    state = state.copyWith(
      enabledScreens: enabled ? Set<String>.from(AppScreen.all) : const {},
    );
    await _saveSettings();
  }

  /// Reset to defaults
  Future<void> resetToDefaults() async {
    // Clear background image first
    await clearBackground();
    state = const AppearanceSettings();
    ToolStyle.setIconPack(IconPack.material);
    await _saveSettings();
  }
}

/// Provider for appearance settings
final appearanceProvider =
    StateNotifierProvider<AppearanceNotifier, AppearanceSettings>((ref) {
      final storage = ref.watch(storageServiceProvider);
      return AppearanceNotifier(storage);
    });

/// Convenience provider for current icon pack
final iconPackProvider = Provider<IconPack>((ref) {
  return ref.watch(appearanceProvider).iconPack;
});

/// Convenience provider for checking if tool colors are enabled
final useToolColorsProvider = Provider<bool>((ref) {
  return ref.watch(appearanceProvider).useToolColors;
});
