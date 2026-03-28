import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:xterm/xterm.dart';

class TerminalSelectionOverlay extends StatelessWidget {
  const TerminalSelectionOverlay({
    super.key,
    required this.terminal,
    required this.controller,
    this.bottomPadding = 0,
  });

  final Terminal terminal;
  final TerminalController controller;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        final selection = controller.selection;
        if (selection == null) return const SizedBox.shrink();

        final ocTheme = OpenCodeTheme.of(context);
        return SafeArea(
          top: false,
          child: Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: EdgeInsets.fromLTRB(12, 8, 12, 12 + bottomPadding),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: ocTheme.backgroundPanel,
                  borderRadius: Radii.brMd,
                  border: Border.all(color: ocTheme.borderSubtle),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 6,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _ActionButton(
                        label: 'Copy',
                        onTap: () async {
                          final text = terminal.buffer.getText(selection);
                          await Clipboard.setData(ClipboardData(text: text));
                        },
                      ),
                      _ActionButton(
                        label: 'Select all',
                        onTap: () {
                          controller.setSelection(
                            terminal.buffer.createAnchor(
                              0,
                              terminal.buffer.height - terminal.viewHeight,
                            ),
                            terminal.buffer.createAnchor(
                              terminal.viewWidth,
                              terminal.buffer.height - 1,
                            ),
                            mode: SelectionMode.line,
                          );
                        },
                      ),
                      _ActionButton(
                        label: 'Clear',
                        onTap: controller.clearSelection,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: TextButton(
        onPressed: onTap,
        style: TextButton.styleFrom(
          foregroundColor: ocTheme.text,
          backgroundColor: ocTheme.background,
          shape: RoundedRectangleBorder(borderRadius: Radii.brSm),
        ),
        child: Text(label, style: const TextStyle(fontWeight: FontWeight.w600)),
      ),
    );
  }
}
