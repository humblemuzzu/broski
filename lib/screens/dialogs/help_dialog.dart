import 'package:flutter/material.dart';

import '../../models/command.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the help dialog with all available commands. Extracted from chat_screen.dart.
void showHelpDialog(
  BuildContext context, {
  required List<SlashCommand> commands,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Available Commands',
    initialSize: 0.7,
    maxSize: 0.9,
    minSize: 0.5,
    child: Padding(
      padding: Insets.screenH,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildCommandSection('Session Actions', [
            ('/undo', 'Undo last message'),
            ('/redo', 'Redo last message'),
            ('/compact', 'Compact session to free context'),
            ('/fork', 'Fork session from a message'),
            ('/rename', 'Rename session'),
            ('/share', 'Share session publicly'),
            ('/unshare', 'Remove public share'),
          ], theme),
          _buildCommandSection('Navigation', [
            ('/new', 'Create new session'),
            ('/clear', 'Alias for /new'),
            ('/session', 'List all sessions'),
            ('/resume', 'Alias for /session'),
            ('/timeline', 'Jump to a message'),
          ], theme),
          _buildCommandSection('Configuration', [
            ('/models', 'List available models'),
            ('/agents', 'List available agents'),
            ('/thinking', 'Toggle thinking visibility'),
          ], theme),
          _buildCommandSection('Export', [
            ('/copy', 'Copy transcript to clipboard'),
            ('/export', 'Export transcript to file'),
          ], theme),
          if (commands.any((c) => !c.builtin))
            _buildCommandSection(
              'Custom Commands',
              commands
                  .where((c) => !c.builtin)
                  .map(
                    (c) => ('/${c.name}', c.description ?? 'No description'),
                  )
                  .toList(),
              theme,
            ),
          SizedBox(height: Spacing.xl),
        ],
      ),
    ),
  );
}

Widget _buildCommandSection(
  String title,
  List<(String, String)> commands,
  OpenCodeTheme theme,
) {
  return Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Padding(
        padding: Insets.chipV,
        child: Text(
          title,
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: theme.primary,
          ),
        ),
      ),
      ...commands.map(
        (cmd) => Padding(
          padding: Insets.chipV,
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: theme.bgDeep,
                  borderRadius: Radii.brXs,
                ),
                child: Text(
                  cmd.$1,
                  style: AppTypography.code(color: theme.accent),
                ),
              ),
              SizedBox(width: Spacing.md),
              Expanded(
                child: Text(
                  cmd.$2,
                  style: AppTypography.bodySmall(color: theme.textMuted),
                ),
              ),
            ],
          ),
        ),
      ),
      SizedBox(height: Spacing.sm),
    ],
  );
}
