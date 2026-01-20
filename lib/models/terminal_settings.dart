class TerminalSettings {
  const TerminalSettings({
    this.fontSize = 13,
    this.fontFamily = 'JetBrains Mono',
    this.maxLines = 10000,
    this.showQuickToolbar = true,
    this.showSelectionToolbar = true,
    this.hardwareKeyboardOnly = false,
    this.deleteDetection = true,
    this.inputBatchMs = 16,
    this.outputBatchMs = 16,
    this.enableBinaryDetection = false,
    this.normalizeSmartQuotes = true,
  });

  final double fontSize;
  final String fontFamily;
  final int maxLines;
  final bool showQuickToolbar;
  final bool showSelectionToolbar;
  final bool hardwareKeyboardOnly;
  final bool deleteDetection;
  final int inputBatchMs;
  final int outputBatchMs;
  final bool enableBinaryDetection;
  final bool normalizeSmartQuotes;

  TerminalSettings copyWith({
    double? fontSize,
    String? fontFamily,
    int? maxLines,
    bool? showQuickToolbar,
    bool? showSelectionToolbar,
    bool? hardwareKeyboardOnly,
    bool? deleteDetection,
    int? inputBatchMs,
    int? outputBatchMs,
    bool? enableBinaryDetection,
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
      inputBatchMs: inputBatchMs ?? this.inputBatchMs,
      outputBatchMs: outputBatchMs ?? this.outputBatchMs,
      enableBinaryDetection:
          enableBinaryDetection ?? this.enableBinaryDetection,
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
      'inputBatchMs': inputBatchMs,
      'outputBatchMs': outputBatchMs,
      'enableBinaryDetection': enableBinaryDetection,
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
      fontSize: asDouble(json['fontSize'], 13),
      fontFamily: (json['fontFamily'] as String?) ?? 'JetBrains Mono',
      maxLines: asInt(json['maxLines'], 10000),
      showQuickToolbar: asBool(json['showQuickToolbar'], true),
      showSelectionToolbar: asBool(json['showSelectionToolbar'], true),
      hardwareKeyboardOnly: asBool(json['hardwareKeyboardOnly'], false),
      deleteDetection: asBool(json['deleteDetection'], true),
      inputBatchMs: asInt(json['inputBatchMs'], 16),
      outputBatchMs: asInt(json['outputBatchMs'], 16),
      enableBinaryDetection: asBool(json['enableBinaryDetection'], false),
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
        other.inputBatchMs == inputBatchMs &&
        other.outputBatchMs == outputBatchMs &&
        other.enableBinaryDetection == enableBinaryDetection &&
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
    inputBatchMs,
    outputBatchMs,
    enableBinaryDetection,
    normalizeSmartQuotes,
  );
}
