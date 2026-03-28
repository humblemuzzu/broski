import 'package:broski/models/command.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A small pill badge showing the command source (command / mcp / skill).
///
/// Used in:
/// - `chat_screen.dart` (slash command autocomplete/picker)
/// - `opencode_commands_screen.dart` (command list)
///
/// Returns [SizedBox.shrink] when [source] is null.
class CommandSourceBadge extends StatelessWidget {
  const CommandSourceBadge({super.key, required this.source});

  final CommandSource? source;

  @override
  Widget build(BuildContext context) {
    if (source == null) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final color = _sourceColor(theme, source!);
    final label = _sourceLabel(source!);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: Radii.brFull,
        border: Border.all(color: color.withValues(alpha: 0.3), width: 1),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontFamily: AppTypography.uiFontFamily,
          fontSize: 9,
          fontWeight: FontWeight.w700,
          color: color,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  static Color _sourceColor(OpenCodeTheme theme, CommandSource source) {
    switch (source) {
      case CommandSource.command:
        return theme.textMuted;
      case CommandSource.mcp:
        return theme.info;
      case CommandSource.skill:
        return theme.accent;
    }
  }

  static String _sourceLabel(CommandSource source) {
    switch (source) {
      case CommandSource.command:
        return 'CMD';
      case CommandSource.mcp:
        return 'MCP';
      case CommandSource.skill:
        return 'SKILL';
    }
  }
}
