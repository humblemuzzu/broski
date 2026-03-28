import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';

/// Shows the Claude Code memory scope picker sheet.
/// Extracted from chat_screen.dart.
///
/// [onScopeSelected] is called with 'user', 'project', or 'local'.
void showMemoryScopePicker(
  BuildContext context, {
  required void Function(String scope) onScopeSelected,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Memory Scope',
    initialSize: 0.35,
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        ListTile(
          leading: Icon(AppIcons.person, color: theme.info),
          title: Text('User memory', style: TextStyle(color: theme.text)),
          subtitle: Text(
            'Persists across projects for your account.',
            style: AppTypography.label(color: theme.textMuted),
          ),
          onTap: () {
            Navigator.pop(context);
            onScopeSelected('user');
          },
        ),
        ListTile(
          leading: Icon(AppIcons.work, color: theme.accent),
          title: Text('Project memory', style: TextStyle(color: theme.text)),
          subtitle: Text(
            'Shared context for this project.',
            style: AppTypography.label(color: theme.textMuted),
          ),
          onTap: () {
            Navigator.pop(context);
            onScopeSelected('project');
          },
        ),
        ListTile(
          leading: Icon(AppIcons.computer, color: theme.warning),
          title: Text('Local memory', style: TextStyle(color: theme.text)),
          subtitle: Text(
            'Only for this machine/workspace.',
            style: AppTypography.label(color: theme.textMuted),
          ),
          onTap: () {
            Navigator.pop(context);
            onScopeSelected('local');
          },
        ),
      ],
    ),
  );
}
