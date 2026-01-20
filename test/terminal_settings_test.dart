import 'package:flutter_test/flutter_test.dart';

import 'package:broski/models/terminal_settings.dart';

void main() {
  test('serializes and deserializes terminal settings', () {
    const settings = TerminalSettings(
      fontSize: 14,
      maxLines: 20000,
      showQuickToolbar: false,
      showSelectionToolbar: false,
      hardwareKeyboardOnly: true,
      deleteDetection: false,
      inputBatchMs: 8,
      outputBatchMs: 25,
      enableBinaryDetection: true,
    );

    final roundTrip = TerminalSettings.fromJson(settings.toJson());
    expect(roundTrip, settings);
  });
}
