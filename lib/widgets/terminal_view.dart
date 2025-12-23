import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart';

import '../theme/colors.dart';

class TerminalPanel extends StatelessWidget {
  const TerminalPanel({super.key, required this.terminal, this.height = 220});

  final Terminal terminal;
  final double height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      decoration: BoxDecoration(
        color: BroskiColors.abyss,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: BroskiColors.slate),
      ),
      padding: const EdgeInsets.all(8),
      child: TerminalView(
        terminal,
        theme: TerminalTheme(
          background: BroskiColors.abyss,
          foreground: BroskiColors.fog,
          cursor: BroskiColors.frost,
          selection: BroskiColors.slate,
          black: Colors.black,
          red: BroskiColors.ember,
          green: BroskiColors.mint,
          yellow: BroskiColors.gold,
          blue: BroskiColors.frost,
          magenta: const Color(0xFFBB9AF7),
          cyan: const Color(0xFF7DCFFF),
          white: Colors.white,
          brightBlack: Colors.grey,
          brightRed: BroskiColors.ember,
          brightGreen: BroskiColors.mint,
          brightYellow: BroskiColors.gold,
          brightBlue: BroskiColors.frost,
          brightMagenta: const Color(0xFFBB9AF7),
          brightCyan: const Color(0xFF7DCFFF),
          brightWhite: Colors.white,
          searchHitBackground: BroskiColors.gold.withOpacity(0.3),
          searchHitBackgroundCurrent: BroskiColors.gold.withOpacity(0.6),
          searchHitForeground: BroskiColors.fog,
        ),
      ),
    );
  }
}
