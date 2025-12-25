import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart';

import '../theme/opencode_theme.dart';

class TerminalPanel extends StatelessWidget {
  const TerminalPanel({super.key, required this.terminal, this.height = 220});

  final Terminal terminal;
  final double height;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: theme.background,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderSubtle),
      ),
      padding: const EdgeInsets.all(8),
      child: TerminalView(
        terminal,
        theme: TerminalTheme(
          background: theme.background,
          foreground: theme.text,
          cursor: theme.primary,
          selection: theme.borderSubtle,
          black: Colors.black,
          red: theme.error,
          green: theme.success,
          yellow: theme.warning,
          blue: theme.primary,
          magenta: theme.accent,
          cyan: theme.info,
          white: Colors.white,
          brightBlack: Colors.grey,
          brightRed: theme.error,
          brightGreen: theme.success,
          brightYellow: theme.warning,
          brightBlue: theme.primary,
          brightMagenta: theme.accent,
          brightCyan: theme.info,
          brightWhite: Colors.white,
          searchHitBackground: theme.warning.withValues(alpha: 0.3),
          searchHitBackgroundCurrent: theme.warning.withValues(alpha: 0.6),
          searchHitForeground: theme.text,
        ),
      ),
    );
  }
}
