/// Navigation bar visual style options
enum NavBarStyle {
  /// Classic style - simple rounded container with icons and labels
  classic,

  /// Glassmorphic floating island - frosted glass with backdrop blur
  glassmorphic,
}

extension NavBarStyleExtension on NavBarStyle {
  String get displayName {
    switch (this) {
      case NavBarStyle.classic:
        return 'Classic';
      case NavBarStyle.glassmorphic:
        return 'Glassmorphic';
    }
  }

  String get description {
    switch (this) {
      case NavBarStyle.classic:
        return 'Simple rounded bar with icons and labels';
      case NavBarStyle.glassmorphic:
        return 'Floating glass island with frosted blur effect';
    }
  }
}
