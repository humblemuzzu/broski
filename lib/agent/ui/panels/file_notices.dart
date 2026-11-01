import 'package:broski/agent/ui/panels/file_verdict.dart';
import 'package:broski/agent/ui/panels/pill.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Where the file is and what it is: its path, whose it is, whether it is
/// new, and what is wrong with it as it stands.
class FileHeader extends StatelessWidget {
  const FileHeader({super.key, required this.file});

  final EditableFile file;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SelectableText(
          file.path,
          style: AppTypography.codeSmall(color: theme.textMuted),
        ),
        Padding(
          padding: Insets.chipV,
          child: Wrap(
            spacing: Spacing.xs,
            children: [
              Pill(text: file.scope, color: theme.info),
              Pill(text: file.format.wire, color: theme.textMuted),
              if (!file.exists) Pill(text: 'new file', color: theme.success),
              if (!file.editable && !file.truncated)
                Pill(text: 'read-only', color: theme.warning),
            ],
          ),
        ),
        for (final problem in file.problems)
          Padding(
            key: const ValueKey('file-problem'),
            padding: Insets.chipV,
            child: Text(
              problem,
              style: AppTypography.bodySmall(color: theme.error),
            ),
          ),
        if (file.truncated)
          Padding(
            key: const ValueKey('file-truncated'),
            padding: Insets.chipV,
            child: Text(
              'This file is longer than the part shown here. It is read-only: '
              'saving would replace the whole file with that part.',
              style: AppTypography.bodySmall(color: theme.warning),
            ),
          ),
      ],
    );
  }
}

/// What the last save, delete or reload ran into, with the way out of it.
/// A refusal never discards the text being edited.
class FileRefusalBanner extends StatelessWidget {
  const FileRefusalBanner({
    super.key,
    required this.verdict,
    required this.onReload,
    required this.busy,
  });

  final FileRefusal verdict;
  final VoidCallback onReload;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final (message, color, reloads) = switch (verdict) {
      FileStale(:final message) => (
        'This file changed on the Mac since you opened it, so nothing was '
            'saved. Your edit is still below. $message',
        theme.warning,
        true,
      ),
      FileInvalid(:final message) => (
        'Not saved: $message The text is kept below.',
        theme.error,
        false,
      ),
      FileLocked(:final message) => (
        'This file cannot be changed here. $message',
        theme.error,
        false,
      ),
      FileMissing(:final message) => (
        'The Mac no longer knows this file. $message',
        theme.error,
        false,
      ),
      FileFailed(:final message) => (message, theme.error, false),
    };
    return Container(
      key: ValueKey('file-refusal:${verdict.runtimeType}'),
      margin: Insets.chipV,
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: Radii.brSm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(message, style: AppTypography.bodySmall(color: color)),
          if (reloads)
            TextButton(
              key: const ValueKey('file-reload'),
              onPressed: busy ? null : onReload,
              child: const Text('Discard my edit and reload'),
            ),
        ],
      ),
    );
  }
}
