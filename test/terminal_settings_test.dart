import 'package:flutter_test/flutter_test.dart';

import 'package:broski/models/terminal_settings.dart';

void main() {
  test('serializes and deserializes terminal settings', () {
    const settings = TerminalSettings(
      fontSize: 16,
      maxLines: 20000,
      showQuickToolbar: false,
      showSelectionToolbar: false,
      normalizeSmartQuotes: false,
      hardwareKeyboardOnly: true,
      deleteDetection: false,
    );

    final roundTrip = TerminalSettings.fromJson(settings.toJson());
    expect(roundTrip, settings);
  });

  test('uses default values for missing JSON fields', () {
    final settings = TerminalSettings.fromJson({});

    expect(settings.fontSize, 14);
    expect(settings.fontFamily, 'JetBrains Mono');
    expect(settings.maxLines, 10000);
    expect(settings.showQuickToolbar, true);
    expect(settings.showSelectionToolbar, true);
    expect(settings.hardwareKeyboardOnly, false);
    expect(settings.deleteDetection, true);
    expect(settings.normalizeSmartQuotes, true);
  });

  test('copyWith preserves unchanged values', () {
    const original = TerminalSettings(fontSize: 12, maxLines: 5000);
    final modified = original.copyWith(fontSize: 18);

    expect(modified.fontSize, 18);
    expect(modified.maxLines, 5000); // Unchanged
  });
}
