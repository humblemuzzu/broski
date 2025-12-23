import 'package:flutter/material.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';

class DiffViewer extends StatefulWidget {
  const DiffViewer({
    super.key,
    required this.diff,
    this.onRevert,
    this.messageId,
  });

  final DiffEntry diff;

  /// Callback for Feature 7: Revert changes for this file
  final void Function(String messageId)? onRevert;

  /// Message ID this diff belongs to (needed for revert)
  final String? messageId;

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

    return GestureDetector(
      onTap: () => setState(() => _isExpanded = !_isExpanded),
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
            if (_isExpanded) ...[
              const SizedBox(height: 14),
              Container(height: 1, color: const Color(0xFF2A2D36)),
              const SizedBox(height: 14),
              _buildDiffContent(),

              // Actions row
              const SizedBox(height: 12),
              Row(
                children: [
                  // Feature 7: Revert button
                  if (widget.onRevert != null && widget.messageId != null)
                    TextButton.icon(
                      onPressed: () {
                        widget.onRevert!(widget.messageId!);
                      },
                      icon: const Icon(
                        Icons.undo_rounded,
                        size: 14,
                        color: Color(0xFFF59E0B),
                      ),
                      label: const Text(
                        'Revert',
                        style: TextStyle(
                          fontSize: 13,
                          color: Color(0xFFF59E0B),
                        ),
                      ),
                    ),
                  const Spacer(),
                  // Collapse hint
                  const Text(
                    'Tap to collapse',
                    style: TextStyle(color: Color(0xFF71717A), fontSize: 12),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildDiffContent() {
    final diffText = _generateUnifiedDiff();
    final lines = diffText.split('\n');
    final preview = lines.take(10).join('\n');
    final hasMore = lines.length > 10;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF17181C),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: const Color(0xFF2A2D36)),
          ),
          child: HighlightView(
            preview,
            language: 'diff',
            theme: atomOneDarkTheme,
            padding: EdgeInsets.zero,
            textStyle: GoogleFonts.jetBrainsMono(fontSize: 12, height: 1.7),
          ),
        ),
        if (hasMore)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Center(
              child: Text(
                'Show ${lines.length - 10} more lines →',
                style: const TextStyle(
                  color: Color(0xFF60A5FA),
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ),
      ],
    );
  }

  String _generateUnifiedDiff() {
    final beforeLines = widget.diff.before.split('\n');
    final afterLines = widget.diff.after.split('\n');

    final buffer = StringBuffer();
    buffer.writeln('--- ${widget.diff.file}');
    buffer.writeln('+++ ${widget.diff.file}');
    buffer.writeln('@@ -1,${beforeLines.length} +1,${afterLines.length} @@');

    // Show deletions
    for (final line in beforeLines) {
      buffer.writeln('-$line');
    }

    // Show additions
    for (final line in afterLines) {
      buffer.writeln('+$line');
    }

    return buffer.toString();
  }

  String _getFileName(String path) {
    if (path.isEmpty) return 'file';
    final parts = path.split('/');
    return parts.last;
  }
}
