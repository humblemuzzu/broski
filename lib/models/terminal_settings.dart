/// Terminal settings model.
///
/// Note: Input/output batching is now handled automatically by SmartInputBatcher
/// and SmartOutputThrottler - no manual tuning needed!
class TerminalSettings {
  const TerminalSettings({
    this.fontSize = 14,
    this.fontFamily = 'JetBrains Mono',
    this.maxLines = 10000,
    this.showQuickToolbar = true,
    this.showSelectionToolbar = true,
    this.hardwareKeyboardOnly = false,
    this.deleteDetection = true,
    this.normalizeSmartQuotes = true,
  });

  /// Font size for terminal text (10-24)
  final double fontSize;

  /// Monospace font family
  final String fontFamily;

  /// Max scrollback lines (1000-100000)
  final int maxLines;

  /// Show quick toolbar with Ctrl keys, arrows, etc.
  final bool showQuickToolbar;

  /// Show copy/select toolbar when text selected
  final bool showSelectionToolbar;

  /// Only accept hardware keyboard input (disable on-screen keyboard)
  final bool hardwareKeyboardOnly;

  /// Enable delete key detection for software keyboards
  final bool deleteDetection;

  /// Convert iOS smart quotes to straight quotes for shell compatibility
  final bool normalizeSmartQuotes;

  TerminalSettings copyWith({
    double? fontSize,
    String? fontFamily,
    int? maxLines,
    bool? showQuickToolbar,
    bool? showSelectionToolbar,
    bool? hardwareKeyboardOnly,
    bool? deleteDetection,
    bool? normalizeSmartQuotes,
  }) {
    return TerminalSettings(
      fontSize: fontSize ?? this.fontSize,
      fontFamily: fontFamily ?? this.fontFamily,
      maxLines: maxLines ?? this.maxLines,
      showQuickToolbar: showQuickToolbar ?? this.showQuickToolbar,
      showSelectionToolbar: showSelectionToolbar ?? this.showSelectionToolbar,
      hardwareKeyboardOnly: hardwareKeyboardOnly ?? this.hardwareKeyboardOnly,
      deleteDetection: deleteDetection ?? this.deleteDetection,
      normalizeSmartQuotes: normalizeSmartQuotes ?? this.normalizeSmartQuotes,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'fontSize': fontSize,
      'fontFamily': fontFamily,
      'maxLines': maxLines,
      'showQuickToolbar': showQuickToolbar,
      'showSelectionToolbar': showSelectionToolbar,
      'hardwareKeyboardOnly': hardwareKeyboardOnly,
      'deleteDetection': deleteDetection,
      'normalizeSmartQuotes': normalizeSmartQuotes,
    };
  }

  factory TerminalSettings.fromJson(Map<String, dynamic> json) {
    double asDouble(dynamic v, double fallback) {
      if (v is num) return v.toDouble();
      return fallback;
    }

    int asInt(dynamic v, int fallback) {
      if (v is int) return v;
      if (v is num) return v.toInt();
      return fallback;
    }

    bool asBool(dynamic v, bool fallback) {
      if (v is bool) return v;
      return fallback;
    }

    return TerminalSettings(
      fontSize: asDouble(json['fontSize'], 14),
      fontFamily: (json['fontFamily'] as String?) ?? 'JetBrains Mono',
      maxLines: asInt(json['maxLines'], 10000),
      showQuickToolbar: asBool(json['showQuickToolbar'], true),
      showSelectionToolbar: asBool(json['showSelectionToolbar'], true),
      hardwareKeyboardOnly: asBool(json['hardwareKeyboardOnly'], false),
      deleteDetection: asBool(json['deleteDetection'], true),
      normalizeSmartQuotes: asBool(json['normalizeSmartQuotes'], true),
    );
  }

  @override
  bool operator ==(Object other) {
    return other is TerminalSettings &&
        other.fontSize == fontSize &&
        other.fontFamily == fontFamily &&
        other.maxLines == maxLines &&
        other.showQuickToolbar == showQuickToolbar &&
        other.showSelectionToolbar == showSelectionToolbar &&
        other.hardwareKeyboardOnly == hardwareKeyboardOnly &&
        other.deleteDetection == deleteDetection &&
        other.normalizeSmartQuotes == normalizeSmartQuotes;
  }

  @override
  int get hashCode => Object.hash(
    fontSize,
    fontFamily,
    maxLines,
    showQuickToolbar,
    showSelectionToolbar,
    hardwareKeyboardOnly,
    deleteDetection,
    normalizeSmartQuotes,
  );
}
