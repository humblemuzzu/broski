import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../models/card_style.dart';
import '../../models/message.dart';
import '../../providers/card_style_provider.dart';
import '../../theme/opencode_theme.dart';
import 'detail_sheet.dart';

/// A compact card for Write (new file creation) operations with inline preview.
/// Shows file path and a few lines of the content being written.
/// Tapping opens full content view in a detail sheet.
///
/// Design matches Claude's style with inline green content lines (all additions).
class CompactWriteCard extends ConsumerWidget {
  final ToolCall tool;
  final String? messageId;
  final void Function(String messageId, String? partId)? onUndo;

  /// Max lines to show in inline preview
  static const int _maxPreviewLines = 5;

  const CompactWriteCard({
    super.key,
    required this.tool,
    this.messageId,
    this.onUndo,
  });

  /// Get the file path from tool input
  /// Handles different backend naming conventions:
  /// - OpenCode: filePath
  /// - Claude Code: path, file_path
  /// - Codex: path in item
  String _getFilePath() {
    return tool.input['filePath'] as String? ??
        tool.input['path'] as String? ??
        tool.input['file_path'] as String? ??
        'Unknown';
  }

  /// Get content being written
  String get _content => tool.input['content'] as String? ?? '';

  /// Build preview content lines (limited to _maxPreviewLines)
  List<String> _buildPreviewLines() {
    if (_content.isEmpty) return [];
    return _content.split('\n');
  }

  /// Count total lines
  int get _totalLines => _content.isEmpty ? 0 : _content.split('\n').length;

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
    final toolColor = theme.toolWrite;

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
            // Header row: Write + file path + line count badge with distinct background
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
                    Icons.add_circle_outline_rounded,
                    size: 16,
                    color: theme.toolWrite,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Write',
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
                  // Line count badge (green for new file)
                  if (!isRunning && _totalLines > 0) ...[
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: theme.diffAdded.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        '+$_totalLines',
                        style: TextStyle(
                          color: theme.diffAdded,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                  if (isRunning) ...[
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(theme.accent),
                      ),
                    ),
                  ] else if (hasError) ...[
                    const SizedBox(width: 8),
                    Icon(Icons.error_outline, size: 16, color: theme.error),
                  ],
                ],
              ),
            ),

            // Inline content preview (all green - new file)
            if (displayLines.isNotEmpty && !isRunning) ...[
              for (final line in displayLines)
                _InlineContentLine(text: line, theme: theme),

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
                  'Writing file...',
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
      title: 'Write',
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

          // Content section with green styling
          DetailSection(
            label: 'Content ($_totalLines lines)',
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: _FullContentView(content: _content),
          ),

          // Result if available
          if (tool.output != null && tool.output!.isNotEmpty)
            DetailSection(
              label: 'Result',
              child: SelectableText(
                tool.output!,
                style: TextStyle(color: theme.text, fontSize: 13),
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
                  label: const Text('Undo Write'),
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

/// Inline content line for the card preview (green for new file)
class _InlineContentLine extends StatelessWidget {
  final String text;
  final OpenCodeTheme theme;

  const _InlineContentLine({required this.text, required this.theme});

  @override
  Widget build(BuildContext context) {
    final color = theme.diffAdded;

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
              text: '+ ',
              style: GoogleFonts.jetBrainsMono(
                color: color,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            TextSpan(
              text: text.isEmpty ? ' ' : text,
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

/// Full content view for the detail sheet
class _FullContentView extends StatelessWidget {
  final String content;

  const _FullContentView({required this.content});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final lines = content.split('\n');
    final color = theme.diffAdded;

    if (lines.isEmpty || content.isEmpty) {
      return Text(
        'No content',
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
        children: [
          for (final line in lines)
            Container(
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
                      text: '+ ',
                      style: GoogleFonts.jetBrainsMono(
                        color: color,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    TextSpan(
                      text: line.isEmpty ? ' ' : line,
                      style: GoogleFonts.jetBrainsMono(
                        color: theme.text,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}
