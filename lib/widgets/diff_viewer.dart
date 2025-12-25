import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';
import '../theme/opencode_theme.dart';
import '../utils/diff_utils.dart';

class DiffViewer extends StatefulWidget {
  const DiffViewer({
    super.key,
    required this.diff,
    required this.messageId,
    this.onUndo,
    this.onViewFull,
  });

  final DiffEntry diff;

  /// Message ID this diff belongs to (needed for undo)
  final String messageId;

  /// Callback for Feature 7: Undo changes (revert specific part when possible)
  final void Function(String messageId, String? partId)? onUndo;

  /// Open full-screen diff view
  final VoidCallback? onViewFull;

  @override
  State<DiffViewer> createState() => _DiffViewerState();
}

class _DiffViewerState extends State<DiffViewer> {
  bool _isExpanded = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final fileName = _getFileName(widget.diff.file);
    final additions = widget.diff.additions;
    final deletions = widget.diff.deletions;

    return InkWell(
      onTap: () => setState(() => _isExpanded = !_isExpanded),
      borderRadius: BorderRadius.circular(14),
      child: Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: theme.borderSubtle, width: 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header - compact
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: theme.borderSubtle.withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(Icons.code, size: 16, color: theme.textMuted),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Row(
                    children: [
                      Flexible(
                        child: Text(
                          fileName,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: theme.text,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Inline badges
                      if (additions > 0)
                        Text(
                          '+$additions',
                          style: TextStyle(
                            fontSize: 11,
                            color: theme.diffAdded,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      if (additions > 0 && deletions > 0)
                        const SizedBox(width: 4),
                      if (deletions > 0)
                        Text(
                          '-$deletions',
                          style: TextStyle(
                            fontSize: 11,
                            color: theme.diffRemoved,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                    ],
                  ),
                ),
                Icon(
                  _isExpanded
                      ? Icons.keyboard_arrow_up
                      : Icons.keyboard_arrow_down,
                  color: theme.textMuted.withValues(alpha: 0.6),
                  size: 20,
                ),
              ],
            ),

            // Expanded diff content
            const SizedBox(height: 12),
            _DiffPreview(diff: widget.diff, maxLines: _isExpanded ? 8 : 3),

            // Actions row (only when expanded)
            if (_isExpanded) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  if (widget.onUndo != null)
                    TextButton.icon(
                      onPressed: () =>
                          widget.onUndo!(widget.messageId, widget.diff.partId),
                      icon: Icon(
                        Icons.undo_rounded,
                        size: 13,
                        color: theme.warning,
                      ),
                      label: Text(
                        'Undo',
                        style: TextStyle(fontSize: 12, color: theme.warning),
                      ),
                      style: TextButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: widget.onViewFull,
                    icon: Icon(
                      Icons.open_in_full_rounded,
                      size: 13,
                      color: theme.info,
                    ),
                    label: Text(
                      'View full',
                      style: TextStyle(
                        fontSize: 12,
                        color: theme.info,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _getFileName(String path) {
    if (path.isEmpty) return 'file';
    final parts = path.split('/');
    return parts.last;
  }
}

class _DiffPreview extends StatelessWidget {
  const _DiffPreview({required this.diff, required this.maxLines});

  final DiffEntry diff;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final diffText = (diff.diff != null && diff.diff!.trim().isNotEmpty)
        ? diff.diff!
        : UnifiedDiff.generate(
            filePath: diff.file.isNotEmpty ? diff.file : 'file',
            before: diff.before,
            after: diff.after,
          );

    final parsed = UnifiedDiff.parse(diffText);
    final previewLines = <DiffLine>[];
    for (final line in parsed) {
      if (line.kind == DiffLineKind.header ||
          line.kind == DiffLineKind.hunk ||
          line.kind == DiffLineKind.meta) {
        continue;
      }
      previewLines.add(line);
      if (previewLines.length >= maxLines) break;
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: previewLines.isEmpty
          ? Text(
              'No preview available',
              style: GoogleFonts.jetBrainsMono(
                fontSize: 11,
                color: theme.textMuted.withValues(alpha: 0.6),
              ),
            )
          : Column(
              children: [
                for (final line in previewLines) _PreviewRow(line: line),
              ],
            ),
    );
  }
}

class _PreviewRow extends StatelessWidget {
  const _PreviewRow({required this.line});

  final DiffLine line;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final bg = switch (line.kind) {
      DiffLineKind.added => theme.diffAdded.withValues(alpha: 0.1),
      DiffLineKind.removed => theme.diffRemoved.withValues(alpha: 0.1),
      _ => Colors.transparent,
    };
    final fg = switch (line.kind) {
      DiffLineKind.added => theme.diffAdded,
      DiffLineKind.removed => theme.diffRemoved,
      _ => theme.text.withValues(alpha: 0.8),
    };
    final prefix = switch (line.kind) {
      DiffLineKind.added => '+',
      DiffLineKind.removed => '-',
      _ => ' ',
    };

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 1),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        '$prefix ${line.text.isEmpty ? ' ' : line.text}',
        style: GoogleFonts.jetBrainsMono(fontSize: 11, color: fg, height: 1.4),
      ),
    );
  }
}
