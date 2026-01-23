/// Style options for tool card headers in chat.
enum CardHeaderStyle {
  /// Solid background from theme (cardHeaderBg) - default, most visible
  solid,

  /// Tinted with tool accent color at low opacity
  tinted,

  /// Minimal/transparent - blends with card body
  minimal,
}

/// Border visibility options for tool cards.
enum CardBorderVisibility {
  /// Very subtle border (cardBorderSubtle)
  subtle,

  /// More visible border (cardHeaderBorder) - default
  visible,

  /// Uses tool accent color for border
  accent,
}

/// Card style settings for tool cards in chat.
class CardStyleSettings {
  final CardHeaderStyle headerStyle;
  final CardBorderVisibility borderVisibility;

  const CardStyleSettings({
    this.headerStyle = CardHeaderStyle.solid,
    this.borderVisibility = CardBorderVisibility.visible,
  });

  /// Default card style settings
  static const defaultSettings = CardStyleSettings();

  CardStyleSettings copyWith({
    CardHeaderStyle? headerStyle,
    CardBorderVisibility? borderVisibility,
  }) {
    return CardStyleSettings(
      headerStyle: headerStyle ?? this.headerStyle,
      borderVisibility: borderVisibility ?? this.borderVisibility,
    );
  }

  @override
  bool operator ==(Object other) {
    if (identical(this, other)) return true;
    return other is CardStyleSettings &&
        other.headerStyle == headerStyle &&
        other.borderVisibility == borderVisibility;
  }

  @override
  int get hashCode => Object.hash(headerStyle, borderVisibility);
}

extension CardHeaderStyleExtension on CardHeaderStyle {
  String get displayName {
    switch (this) {
      case CardHeaderStyle.solid:
        return 'Solid';
      case CardHeaderStyle.tinted:
        return 'Tinted';
      case CardHeaderStyle.minimal:
        return 'Minimal';
    }
  }

  String get description {
    switch (this) {
      case CardHeaderStyle.solid:
        return 'Distinct header background';
      case CardHeaderStyle.tinted:
        return 'Tool color tint';
      case CardHeaderStyle.minimal:
        return 'Transparent/subtle';
    }
  }
}

extension CardBorderVisibilityExtension on CardBorderVisibility {
  String get displayName {
    switch (this) {
      case CardBorderVisibility.subtle:
        return 'Subtle';
      case CardBorderVisibility.visible:
        return 'Visible';
      case CardBorderVisibility.accent:
        return 'Accent';
    }
  }

  String get description {
    switch (this) {
      case CardBorderVisibility.subtle:
        return 'Barely visible borders';
      case CardBorderVisibility.visible:
        return 'Clear card separation';
      case CardBorderVisibility.accent:
        return 'Tool-colored borders';
    }
  }
}
