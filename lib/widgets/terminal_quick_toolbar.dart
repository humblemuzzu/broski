import 'package:flutter/material.dart';
import '../theme/app_typography.dart';
import 'package:flutter/services.dart';
import 'package:xterm/xterm.dart';

import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';

class TerminalQuickToolbar extends StatelessWidget {
  const TerminalQuickToolbar({super.key, required this.terminal});
  final Terminal terminal;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      color: ocTheme.backgroundPanel,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            _KeyButton(
              label: 'Esc',
              onTap: () => terminal.keyInput(TerminalKey.escape),
            ),
            _KeyButton(
              label: 'Tab',
              onTap: () => terminal.keyInput(TerminalKey.tab),
            ),
            _KeyButton(
              label: 'Enter',
              onTap: () => terminal.keyInput(TerminalKey.enter),
            ),
            _KeyButton(
              icon: AppIcons.arrowUp,
              onTap: () => terminal.keyInput(TerminalKey.arrowUp),
            ),
            _KeyButton(
              icon: AppIcons.arrowDown,
              onTap: () => terminal.keyInput(TerminalKey.arrowDown),
            ),
            _KeyButton(
              icon: AppIcons.back,
              onTap: () => terminal.keyInput(TerminalKey.arrowLeft),
            ),
            _KeyButton(
              icon: AppIcons.forward,
              onTap: () => terminal.keyInput(TerminalKey.arrowRight),
            ),
            _KeyButton(
              label: 'Ctrl+C',
              onTap: () => terminal.keyInput(TerminalKey.keyC, ctrl: true),
            ),
            _KeyButton(
              label: 'Ctrl+D',
              onTap: () => terminal.keyInput(TerminalKey.keyD, ctrl: true),
            ),
            _KeyButton(
              label: 'Clear',
              onTap: () => terminal.keyInput(TerminalKey.keyL, ctrl: true),
            ),
            _KeyButton(
              label: 'Paste',
              onTap: () async {
                final data = await Clipboard.getData(Clipboard.kTextPlain);
                final text = data?.text;
                if (text == null || text.isEmpty) return;
                terminal.paste(text);
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _KeyButton extends StatelessWidget {
  const _KeyButton({this.label, this.icon, required this.onTap});
  final String? label;
  final IconData? icon;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Material(
        color: ocTheme.background,
        borderRadius: Radii.brSm,
        child: InkWell(
          onTap: onTap,
          borderRadius: Radii.brSm,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            child: icon != null
                ? Icon(icon, size: 16, color: ocTheme.textMuted)
                : Text(
                    label ?? '',
                    style: TextStyle(
                      color: ocTheme.textMuted,
                      fontSize: 12,
                      fontFamily: AppTypography.codeFontFamily,
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}
