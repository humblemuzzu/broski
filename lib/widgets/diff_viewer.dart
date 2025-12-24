import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';
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
    final fileName = _getFileName(widget.diff.file);
    final additions = widget.diff.additions;
    final deletions = widget.diff.deletions;

    return InkWell(
      onTap: () => setState(() => _isExpanded = !_isExpanded),
      borderRadius: BorderRadius.circular(18),
      child: Container(
        margin: const EdgeInsets.only(top: 10),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF1F2128),
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: const Color(0xFF2A2D36), width: 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(
                    color: const Color(0xFF2A2D36),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: const Icon(
                    Icons.code,
                    size: 18,
                    color: Color(0xFF9CA3AF),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        fileName,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: Color(0xFFE4E4E7),
                        ),
                      ),
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          if (additions > 0)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(
                                  0xFF10B981,
                                ).withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                '+$additions',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: Color(0xFF10B981),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          if (additions > 0 && deletions > 0)
                            const SizedBox(width: 6),
                          if (deletions > 0)
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: const Color(
                                  0xFFEF4444,
                                ).withValues(alpha: 0.1),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                '-$deletions',
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: Color(0xFFEF4444),
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
                Icon(
                  _isExpanded
                      ? Icons.keyboard_arrow_up
                      : Icons.keyboard_arrow_down,
                  color: const Color(0xFF71717A),
                  size: 22,
                ),
              ],
            ),

            // Expanded diff content
            const SizedBox(height: 14),
            _DiffPreview(
              diff: widget.diff,
              maxLines: _isExpanded ? 10 : 4,
            ),

            // Actions row (only when expanded)
            if (_isExpanded) ...[
              const SizedBox(height: 12),
              Row(
                children: [
                  if (widget.onUndo != null)
                    TextButton.icon(
                      onPressed: () => widget.onUndo!(
                        widget.messageId,
                        widget.diff.partId,
                      ),
                      icon: const Icon(
                        Icons.undo_rounded,
                        size: 14,
                        color: Color(0xFFF59E0B),
                      ),
                      label: const Text(
                        'Undo',
                        style: TextStyle(
                          fontSize: 13,
                          color: Color(0xFFF59E0B),
                        ),
                      ),
                    ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: widget.onViewFull,
                    icon: const Icon(
                      Icons.open_in_full_rounded,
                      size: 14,
                      color: Color(0xFF60A5FA),
                    ),
                    label: const Text(
                      'View full',
                      style: TextStyle(
                        fontSize: 13,
                        color: Color(0xFF60A5FA),
                        fontWeight: FontWeight.w600,
                      ),
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

  static const _kSurface = Color(0xFF17181C);
  static const _kBorder = Color(0xFF2A2D36);
  static const _kMuted = Color(0xFF9CA3AF);

  final DiffEntry diff;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
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
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _kSurface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _kBorder),
      ),
      child: previewLines.isEmpty
          ? Text(
              'No preview available',
              style: GoogleFonts.jetBrainsMono(fontSize: 12, color: _kMuted),
            )
          : Column(
              children: [for (final line in previewLines) _PreviewRow(line: line)],
            ),
    );
  }
}

class _PreviewRow extends StatelessWidget {
  const _PreviewRow({required this.line});

  static const _kText = Color(0xFFE4E4E7);
  static const _kAdd = Color(0xFF10B981);
  static const _kDel = Color(0xFFEF4444);

  final DiffLine line;

  @override
  Widget build(BuildContext context) {
    final bg = switch (line.kind) {
      DiffLineKind.added => _kAdd.withValues(alpha: 0.12),
      DiffLineKind.removed => _kDel.withValues(alpha: 0.12),
      _ => Colors.transparent,
    };
    final fg = switch (line.kind) {
      DiffLineKind.added => _kAdd,
      DiffLineKind.removed => _kDel,
      _ => _kText,
    };
    final prefix = switch (line.kind) {
      DiffLineKind.added => '+',
      DiffLineKind.removed => '-',
      _ => ' ',
    };

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 2),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        '$prefix ${line.text.isEmpty ? ' ' : line.text}',
        style: GoogleFonts.jetBrainsMono(
          fontSize: 12,
          color: fg,
          height: 1.35,
        ),
      ),
    );
  }
}
