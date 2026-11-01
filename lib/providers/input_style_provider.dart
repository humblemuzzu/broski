import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Input bar style options
enum InputBarStyle {
  /// ChatGPT-style: Rounded pill with plus button and send arrow
  chatgpt,

  /// CLI-style: terminal-like input with the model selector at the bottom
  cli,
}

class InputStyleNotifier extends StateNotifier<InputBarStyle> {
  InputStyleNotifier() : super(InputBarStyle.chatgpt) {
    _loadStyle();
  }

  Future<void> _loadStyle() async {
    final prefs = await SharedPreferences.getInstance();
    final styleString = prefs.getString('input_bar_style') ?? 'chatgpt';
    state = styleString == 'cli' ? InputBarStyle.cli : InputBarStyle.chatgpt;
  }

  Future<void> setStyle(InputBarStyle style) async {
    state = style;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      'input_bar_style',
      style == InputBarStyle.cli ? 'cli' : 'chatgpt',
    );
  }
}

final inputStyleProvider =
    StateNotifierProvider<InputStyleNotifier, InputBarStyle>((ref) {
      return InputStyleNotifier();
    });
