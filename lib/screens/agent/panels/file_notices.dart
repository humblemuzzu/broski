import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/file_verdict.dart';
import 'package:broski/screens/agent/panels/pill.dart';
import 'package:broski/theme/app_icons.dart';
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
    return Container(
      padding: Insets.cardMd,
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _HeaderPath(path: file.path, theme: theme),
          _HeaderPills(file: file, theme: theme),
          if (file.problems.isNotEmpty)
            _HeaderProblems(problems: file.problems, theme: theme),
          if (file.truncated) const _HeaderTruncated(),
        ],
      ),
    );
  }
}

class _HeaderPath extends StatelessWidget {
  const _HeaderPath({required this.path, required this.theme});

  final String path;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(AppIcons.description, size: 14, color: theme.textMuted),
      const SizedBox(width: 6),
      Expanded(
        child: SelectableText(
          path,
          style: AppTypography.codeSmall(color: theme.text),
        ),
      ),
    ],
  );
}

class _HeaderPills extends StatelessWidget {
  const _HeaderPills({required this.file, required this.theme});

  final EditableFile file;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: Spacing.sm),
    child: Wrap(
      spacing: Spacing.xs,
      runSpacing: Spacing.xs,
      children: [
        Pill(text: file.scope, color: theme.info),
        Pill(text: file.format.wire, color: theme.textMuted),
        if (!file.exists) Pill(text: 'new file', color: theme.success),
        if (!file.editable && !file.truncated)
          Pill(text: 'read-only', color: theme.warning),
      ],
    ),
  );
}

class _HeaderProblems extends StatelessWidget {
  const _HeaderProblems({required this.problems, required this.theme});

  final List<String> problems;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Padding(
    key: const ValueKey('file-problem'),
    padding: const EdgeInsets.only(top: Spacing.sm),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final problem in problems)
          Text(problem, style: AppTypography.bodySmall(color: theme.error)),
      ],
    ),
  );
}

class _HeaderTruncated extends StatelessWidget {
  const _HeaderTruncated();

  @override
  Widget build(BuildContext context) => Padding(
    key: const ValueKey('file-truncated'),
    padding: const EdgeInsets.only(top: Spacing.sm),
    child: Text(
      'This file is longer than the part shown here. It is read-only: '
      'saving would replace the whole file with that part.',
      style: AppTypography.bodySmall(color: OpenCodeTheme.of(context).warning),
    ),
  );
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
    final (message, color, reloads, icon) = _describe(theme);
    return Container(
      key: ValueKey('file-refusal:${verdict.runtimeType}'),
      padding: Insets.cardMd,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: Radii.brSm,
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 16, color: color),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  message,
                  style: AppTypography.bodySmall(color: color),
                ),
              ),
            ],
          ),
          if (reloads)
            Padding(
              padding: const EdgeInsets.only(top: Spacing.sm),
              child: _Reload(enabled: !busy, onTap: onReload, color: color),
            ),
        ],
      ),
    );
  }

  (String, Color, bool, IconData) _describe(OpenCodeTheme theme) =>
      switch (verdict) {
        FileStale(:final message) => (
          'This file changed on the Mac since you opened it, so nothing was '
              'saved. Your edit is still below. $message',
          theme.warning,
          true,
          AppIcons.warning,
        ),
        FileInvalid(:final message) => (
          'Not saved: $message The text is kept below.',
          theme.error,
          false,
          AppIcons.error,
        ),
        FileLocked(:final message) => (
          'This file cannot be changed here. $message',
          theme.error,
          false,
          AppIcons.error,
        ),
        FileMissing(:final message) => (
          'The Mac no longer knows this file. $message',
          theme.error,
          false,
          AppIcons.error,
        ),
        FileFailed(:final message) => (
          message,
          theme.error,
          false,
          AppIcons.error,
        ),
      };
}

/// The thin bar that says the file is being written or read.
class FileWorkingBar extends StatelessWidget {
  const FileWorkingBar({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ClipRRect(
      borderRadius: Radii.brFull,
      child: LinearProgressIndicator(
        minHeight: 2,
        semanticsLabel: 'Working',
        backgroundColor: theme.borderSubtle.withValues(alpha: 0.3),
        valueColor: AlwaysStoppedAnimation(theme.primary),
      ),
    );
  }
}

/// How much text the file holds, or what the last save said.
class FileEditStatus extends StatelessWidget {
  const FileEditStatus({
    super.key,
    required this.length,
    required this.done,
    required this.theme,
  });

  final int length;
  final String? done;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    final over = length - contractMaxTextChars;
    return Text(
      over > 0
          ? 'Over the limit by $over characters: cut some to save.'
          : done ?? '$length characters',
      key: const ValueKey('file-status'),
      style: AppTypography.caption(
        color: over > 0 ? theme.error : theme.textMuted,
      ),
    );
  }
}

class _Reload extends StatelessWidget {
  const _Reload({
    required this.enabled,
    required this.onTap,
    required this.color,
  });

  final bool enabled;
  final VoidCallback onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final tone = enabled ? color : OpenCodeTheme.of(context).border;
    return GestureDetector(
      key: const ValueKey('file-reload'),
      onTap: enabled ? onTap : null,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          borderRadius: Radii.brSm,
          border: Border.all(color: tone.withValues(alpha: 0.45)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.refresh, size: 14, color: tone),
            const SizedBox(width: 6),
            Text(
              'Discard my edit and reload',
              style: AppTypography.label(
                color: tone,
              ).copyWith(fontWeight: FontWeight.w600),
            ),
          ],
        ),
      ),
    );
  }
}
