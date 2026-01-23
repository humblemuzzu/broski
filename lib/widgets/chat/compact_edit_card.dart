import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../models/card_style.dart';
import '../../models/message.dart';
import '../../providers/card_style_provider.dart';
import '../../theme/opencode_theme.dart';
import 'detail_sheet.dart';

/// A compact card for Edit/Patch operations with inline diff preview.
/// Shows file path and a few lines of the actual diff directly on the card.
/// Tapping opens full diff view in a detail sheet.
///
/// Design matches Claude's edit cards with inline red/green diff lines.
class CompactEditCard extends ConsumerWidget {
  final ToolCall tool;
  final String? messageId;
  final void Function(String messageId, String? partId)? onUndo;

  /// Max lines to show in inline preview
  static const int _maxPreviewLines = 5;

  const CompactEditCard({
    super.key,
    required this.tool,
    this.messageId,
    this.onUndo,
  });

  /// Get the file path from tool input
  /// Handles different backend naming conventions:
  /// - OpenCode: filePath
  /// - Claude Code: path, file_path
  /// - Codex: changes[0].path or path in item
  String _getFilePath() {
    // Try standard field names first
    final filePath =
        tool.input['filePath'] as String? ??
        tool.input['path'] as String? ??
        tool.input['file_path'] as String?;
    if (filePath != null && filePath.isNotEmpty) return filePath;

    // Codex: Check changes array
    final changes = tool.input['changes'];
    if (changes is List && changes.isNotEmpty) {
      final first = changes[0];
      if (first is Map<String, dynamic>) {
        final changePath = first['path'] as String?;
        if (changePath != null && changePath.isNotEmpty) return changePath;
      }
    }

    return 'Unknown';
  }

  /// Get old string content (before edit)
  /// Handles different backend data locations:
  /// - OpenCode: input.oldString
  /// - Claude Code: metadata.filediff.before, metadata.toolUseResult.oldString
  /// - str_replace_editor: input.old_str
  String get _oldString {
    // Check input with all possible key variants
    final fromInput =
        tool.input['oldString'] as String? ??
        tool.input['old_str'] as String? ??
        tool.input['old_string'] as String? ??
        tool.input['old'] as String? ??
        tool.input['original'] as String? ??
        tool.input['originalFile'] as String?;
    if (fromInput != null && fromInput.isNotEmpty) return fromInput;

    // Claude Code: check metadata.filediff.before
    final filediff = tool.metadata['filediff'];
    if (filediff is Map<String, dynamic>) {
      final before = filediff['before'] as String?;
      if (before != null && before.isNotEmpty) return before;
    }

    // Claude Code: check metadata.toolUseResult directly
    final toolUseResult = tool.metadata['toolUseResult'];
    if (toolUseResult is Map<String, dynamic>) {
      final old =
          toolUseResult['oldString'] as String? ??
          toolUseResult['old_str'] as String? ??
          toolUseResult['originalFile'] as String?;
      if (old != null && old.isNotEmpty) return old;
    }

    return '';
  }

  /// Get new string content (after edit)
  /// Handles different backend data locations:
  /// - OpenCode: input.newString
  /// - Claude Code: metadata.filediff.after, metadata.toolUseResult.newString
  /// - str_replace_editor: input.new_str
  String get _newString {
    // Check input with all possible key variants
    final fromInput =
        tool.input['newString'] as String? ??
        tool.input['new_str'] as String? ??
        tool.input['new_string'] as String? ??
        tool.input['new'] as String? ??
        tool.input['replacement'] as String? ??
        tool.input['content'] as String?;
    if (fromInput != null && fromInput.isNotEmpty) return fromInput;

    // Claude Code: check metadata.filediff.after
    final filediff = tool.metadata['filediff'];
    if (filediff is Map<String, dynamic>) {
      final after = filediff['after'] as String?;
      if (after != null && after.isNotEmpty) return after;
    }

    // Claude Code: check metadata.toolUseResult directly
    final toolUseResult = tool.metadata['toolUseResult'];
    if (toolUseResult is Map<String, dynamic>) {
      final newStr =
          toolUseResult['newString'] as String? ??
          toolUseResult['new_str'] as String? ??
          toolUseResult['content'] as String?;
      if (newStr != null && newStr.isNotEmpty) return newStr;
    }

    return '';
  }

  /// Get unified diff text
  /// Handles different backend data locations:
  /// - Codex: input.changes[0].diff or input.aggregatedOutput
  /// - Claude Code: metadata.diff (from toolUseResult)
  String? get _unifiedDiff {
    // Claude Code: check metadata.diff first (most reliable)
    final metaDiff = tool.metadata['diff'] as String?;
    if (metaDiff != null && metaDiff.isNotEmpty) return metaDiff;

    // Codex: check changes array with diff
    final changes = tool.input['changes'];
    if (changes is List && changes.isNotEmpty) {
      final first = changes[0];
      if (first is Map<String, dynamic>) {
        final diff = first['diff'] as String?;
        if (diff != null && diff.isNotEmpty) return diff;
      }
    }

    // Codex: check aggregatedOutput
    final aggregated = tool.input['aggregatedOutput'] as String?;
    if (aggregated != null && aggregated.isNotEmpty) return aggregated;

    return null;
  }

  /// Build preview diff lines (limited to _maxPreviewLines)
  /// Handles both oldString/newString format and unified diff format
  List<_DiffLine> _buildPreviewLines() {
    final lines = <_DiffLine>[];

    // First check for unified diff (Codex format)
    final diff = _unifiedDiff;
    if (diff != null && diff.isNotEmpty) {
      return _parseUnifiedDiff(diff);
    }

    // Fall back to oldString/newString format (OpenCode/Claude Code)
    // Add removed lines
    if (_oldString.isNotEmpty) {
      for (final line in _oldString.split('\n')) {
        lines.add(_DiffLine(text: line, isAdded: false));
      }
    }

    // Add added lines
    if (_newString.isNotEmpty) {
      for (final line in _newString.split('\n')) {
        lines.add(_DiffLine(text: line, isAdded: true));
      }
    }

    return lines;
  }

  /// Parse unified diff format into diff lines
  List<_DiffLine> _parseUnifiedDiff(String diff) {
    final lines = <_DiffLine>[];
    for (final line in diff.split('\n')) {
      // Skip diff headers (---, +++, @@)
      if (line.startsWith('---') ||
          line.startsWith('+++') ||
          line.startsWith('@@') ||
          line.startsWith('diff ') ||
          line.startsWith('index ')) {
        continue;
      }
      // Parse added/removed lines
      if (line.startsWith('+')) {
        lines.add(_DiffLine(text: line.substring(1), isAdded: true));
      } else if (line.startsWith('-')) {
        lines.add(_DiffLine(text: line.substring(1), isAdded: false));
      }
      // Skip context lines (no prefix) for cleaner preview
    }
    return lines;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final cardStyle = ref.watch(cardStyleProvider);
    final isRunning = tool.status == 'running';
    final hasError = tool.status == 'error';

    final previewLines = _buildPreviewLines();
    final hasMoreLines = previewLines.length > _maxPreviewLines;
    final displayLines = previewLines.take(_maxPreviewLines).toList();

    // Determine colors based on card style settings
    final Color headerBg;
    final Color borderColor;
    final toolColor = theme.toolEdit;

    switch (cardStyle.headerStyle) {
      case CardHeaderStyle.solid:
        headerBg = theme.cardHeaderBg;
      case CardHeaderStyle.tinted:
        headerBg = toolColor.withValues(alpha: 0.1);
      case CardHeaderStyle.minimal:
        headerBg = Colors.transparent;
    }

    switch (cardStyle.borderVisibility) {
      case CardBorderVisibility.subtle:
        borderColor = theme.cardBorderSubtle;
      case CardBorderVisibility.visible:
        borderColor = theme.cardHeaderBorder;
      case CardBorderVisibility.accent:
        borderColor = toolColor.withValues(alpha: 0.5);
    }

    return GestureDetector(
      onTap: () => _showDetailSheet(context),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: hasError
                ? theme.error.withValues(alpha: 0.5)
                : isRunning
                ? theme.accent.withValues(alpha: 0.4)
                : borderColor,
            width: isRunning ? 1.5 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header row: Edit + file path with distinct background
            Container(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
              decoration: BoxDecoration(
                color: headerBg,
                border: Border(
                  bottom: BorderSide(color: borderColor, width: 1),
                ),
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(11),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.edit_note_rounded,
                    size: 16,
                    color: theme.toolEdit,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Edit',
                    style: TextStyle(
                      color: theme.cardHeaderText,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      _getFilePath(),
                      style: GoogleFonts.jetBrainsMono(
                        color: theme.text,
                        fontSize: 12,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (isRunning)
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(theme.accent),
                      ),
                    )
                  else if (hasError)
                    Icon(Icons.error_outline, size: 16, color: theme.error),
                ],
              ),
            ),

            // Inline diff preview
            if (displayLines.isNotEmpty && !isRunning) ...[
              for (final line in displayLines) _InlineDiffLine(line: line),

              // "More lines" indicator
              if (hasMoreLines)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  color: theme.backgroundElement.withValues(alpha: 0.5),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.expand_more, size: 14, color: theme.textMuted),
                      const SizedBox(width: 4),
                      Text(
                        '${previewLines.length - _maxPreviewLines} more lines',
                        style: TextStyle(color: theme.textMuted, fontSize: 11),
                      ),
                    ],
                  ),
                ),
            ],

            // Running state placeholder
            if (isRunning)
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
                child: Text(
                  'Applying changes...',
                  style: TextStyle(
                    color: theme.textMuted,
                    fontSize: 12,
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  void _showDetailSheet(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final canUndo =
        onUndo != null && tool.status == 'completed' && messageId != null;

    DetailSheet.show(
      context: context,
      title: 'Edit',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // File path section
          DetailSection(
            label: 'File',
            child: SelectableText(
              _getFilePath(),
              style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
            ),
          ),

          // Diff content section
          DetailSection(
            label: 'Changes',
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: _FullDiffContent(
              oldString: _oldString,
              newString: _newString,
              unifiedDiff: _unifiedDiff,
            ),
          ),

          // Undo button if available
          if (canUndo)
            Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: () {
                    Navigator.of(context).pop();
                    onUndo!(messageId!, tool.partId);
                  },
                  icon: const Icon(Icons.undo, size: 18),
                  label: const Text('Undo Edit'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.warning,
                    side: BorderSide(
                      color: theme.warning.withValues(alpha: 0.5),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Data class for a diff line
class _DiffLine {
  final String text;
  final bool isAdded;

  const _DiffLine({required this.text, required this.isAdded});
}

/// Inline diff line for the card preview
class _InlineDiffLine extends StatelessWidget {
  final _DiffLine line;

  const _InlineDiffLine({required this.line});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final isAdded = line.isAdded;
    final color = isAdded ? theme.diffAdded : theme.diffRemoved;
    final prefix = isAdded ? '+' : '-';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        border: Border(left: BorderSide(color: color, width: 3)),
      ),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: '$prefix ',
              style: GoogleFonts.jetBrainsMono(
                color: color,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            TextSpan(
              text: line.text.isEmpty ? ' ' : line.text,
              style: GoogleFonts.jetBrainsMono(
                color: color.withValues(alpha: 0.9),
                fontSize: 12,
              ),
            ),
          ],
        ),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
    );
  }
}

/// Full diff content for the detail sheet
class _FullDiffContent extends StatelessWidget {
  final String oldString;
  final String newString;
  final String? unifiedDiff;

  const _FullDiffContent({
    required this.oldString,
    required this.newString,
    this.unifiedDiff,
  });

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final diffLines = <Widget>[];

    // If we have unified diff, parse and display it
    if (unifiedDiff != null && unifiedDiff!.isNotEmpty) {
      for (final line in unifiedDiff!.split('\n')) {
        // Skip diff headers
        if (line.startsWith('---') ||
            line.startsWith('+++') ||
            line.startsWith('diff ') ||
            line.startsWith('index ')) {
          continue;
        }
        // Hunk headers get special styling
        if (line.startsWith('@@')) {
          diffLines.add(
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              color: theme.info.withValues(alpha: 0.1),
              child: Text(
                line,
                style: GoogleFonts.jetBrainsMono(
                  color: theme.info,
                  fontSize: 11,
                ),
              ),
            ),
          );
          continue;
        }
        // Added lines
        if (line.startsWith('+')) {
          diffLines.add(
            _buildDiffLine(
              line: line.substring(1),
              prefix: '+',
              color: theme.diffAdded,
              theme: theme,
            ),
          );
        }
        // Removed lines
        else if (line.startsWith('-')) {
          diffLines.add(
            _buildDiffLine(
              line: line.substring(1),
              prefix: '-',
              color: theme.diffRemoved,
              theme: theme,
            ),
          );
        }
        // Context lines
        else if (line.isNotEmpty) {
          diffLines.add(
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              child: Text(
                '  $line',
                style: GoogleFonts.jetBrainsMono(
                  color: theme.textMuted,
                  fontSize: 12,
                ),
              ),
            ),
          );
        }
      }
    } else {
      // Fall back to oldString/newString format
      // Add removed lines
      if (oldString.isNotEmpty) {
        for (final line in oldString.split('\n')) {
          diffLines.add(
            _buildDiffLine(
              line: line,
              prefix: '-',
              color: theme.diffRemoved,
              theme: theme,
            ),
          );
        }
      }

      // Add added lines
      if (newString.isNotEmpty) {
        for (final line in newString.split('\n')) {
          diffLines.add(
            _buildDiffLine(
              line: line,
              prefix: '+',
              color: theme.diffAdded,
              theme: theme,
            ),
          );
        }
      }
    }

    if (diffLines.isEmpty) {
      return Text(
        'No changes',
        style: TextStyle(color: theme.textMuted, fontStyle: FontStyle.italic),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.borderSubtle.withValues(alpha: 0.5)),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: diffLines,
      ),
    );
  }

  Widget _buildDiffLine({
    required String line,
    required String prefix,
    required Color color,
    required OpenCodeTheme theme,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        border: Border(left: BorderSide(color: color, width: 3)),
      ),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: '$prefix ',
              style: GoogleFonts.jetBrainsMono(
                color: color,
                fontSize: 12,
                fontWeight: FontWeight.bold,
              ),
            ),
            TextSpan(
              text: line.isEmpty ? ' ' : line,
              style: GoogleFonts.jetBrainsMono(color: theme.text, fontSize: 12),
            ),
          ],
        ),
      ),
    );
  }
}
