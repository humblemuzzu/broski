import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';
import '../theme/opencode_theme.dart';
import '../utils/diff_utils.dart';

class DiffViewScreen extends StatefulWidget {
  const DiffViewScreen({
    super.key,
    required this.diff,
    this.onUndo,
    this.messageId,
  });

  final DiffEntry diff;

  /// Undo handler (calls session.revert with messageID/partID).
  final void Function(String messageId, String partId)? onUndo;

  /// Message ID owning this diff (needed for undo).
  final String? messageId;

  @override
  State<DiffViewScreen> createState() => _DiffViewScreenState();
}

class _DiffViewScreenState extends State<DiffViewScreen> {
  late String _diffText;
  late List<DiffLine> _lines;

  double _fontSize = 12.5;
  double _scaleStartFont = 12.5;

  @override
  void initState() {
    super.initState();
    _diffText = _resolveDiffText();
    _lines = UnifiedDiff.parse(_diffText);
  }

  String _resolveDiffText() {
    final d = widget.diff;
    if (d.diff != null && d.diff!.trim().isNotEmpty) {
      return d.diff!;
    }
    // Fallback: generate unified diff from before/after (used for session.diff events).
    return UnifiedDiff.generate(
      filePath: d.file.isNotEmpty ? d.file : 'file',
      before: d.before,
      after: d.after,
    );
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final fileName = _fileName(widget.diff.file);
    final canUndo =
        widget.onUndo != null &&
        widget.messageId != null &&
        widget.diff.partId != null &&
        widget.diff.partId!.isNotEmpty;

    final maxOld = _maxLine(_lines.map((l) => l.oldLine));
    final maxNew = _maxLine(_lines.map((l) => l.newLine));
    final gutterDigits = max(_digits(maxOld), _digits(maxNew));

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.background,
        foregroundColor: ocTheme.text,
        elevation: 0,
        titleSpacing: 0,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              fileName,
              style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 2),
            Row(
              children: [
                if (widget.diff.additions > 0)
                  Text(
                    '+${widget.diff.additions}',
                    style: TextStyle(
                      fontSize: 12,
                      color: ocTheme.success,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                if (widget.diff.additions > 0 && widget.diff.deletions > 0)
                  const SizedBox(width: 8),
                if (widget.diff.deletions > 0)
                  Text(
                    '-${widget.diff.deletions}',
                    style: TextStyle(
                      fontSize: 12,
                      color: ocTheme.error,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Copy diff',
            onPressed: () => _copy(context),
            icon: const Icon(Icons.copy_rounded),
          ),
          IconButton(
            tooltip: 'Reset zoom',
            onPressed: () => setState(() => _fontSize = 12.5),
            icon: const Icon(Icons.text_fields_rounded),
          ),
          if (canUndo)
            IconButton(
              tooltip: 'Undo',
              onPressed: () =>
                  widget.onUndo!(widget.messageId!, widget.diff.partId!),
              icon: const Icon(Icons.undo_rounded),
            ),
        ],
      ),
      body: GestureDetector(
        onScaleStart: (_) => _scaleStartFont = _fontSize,
        onScaleUpdate: (details) {
          if (details.pointerCount < 2) return;
          final next = (_scaleStartFont * details.scale).clamp(10.0, 20.0);
          if (next == _fontSize) return;
          setState(() => _fontSize = next);
        },
        child: Container(
          margin: const EdgeInsets.fromLTRB(16, 10, 16, 16),
          decoration: BoxDecoration(
            color: ocTheme.backgroundPanel,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: ocTheme.borderSubtle),
          ),
          clipBehavior: Clip.antiAlias,
          child: ListView.builder(
            padding: const EdgeInsets.symmetric(vertical: 10),
            itemCount: _lines.length,
            itemBuilder: (context, index) {
              final line = _lines[index];
              return _DiffRow(
                line: line,
                fontSize: _fontSize,
                gutterDigits: gutterDigits,
              );
            },
          ),
        ),
      ),
    );
  }

  Future<void> _copy(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: _diffText));
    if (!context.mounted) return;
    final ocTheme = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Diff copied'),
        behavior: SnackBarBehavior.floating,
        backgroundColor: ocTheme.backgroundPanel,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  String _fileName(String path) {
    if (path.isEmpty) return 'file';
    final parts = path.split('/');
    return parts.isNotEmpty ? parts.last : path;
  }

  int _maxLine(Iterable<int?> values) {
    var maxValue = 0;
    for (final v in values) {
      if (v == null) continue;
      if (v > maxValue) maxValue = v;
    }
    return maxValue;
  }

  int _digits(int value) {
    if (value <= 0) return 1;
    return value.toString().length;
  }
}

class _DiffRow extends StatelessWidget {
  const _DiffRow({
    required this.line,
    required this.fontSize,
    required this.gutterDigits,
  });

  final DiffLine line;
  final double fontSize;
  final int gutterDigits;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final bg = _background(line.kind, ocTheme);
    final fg = _foreground(line.kind, ocTheme);
    final showGutter =
        line.kind != DiffLineKind.header &&
        line.kind != DiffLineKind.hunk &&
        line.kind != DiffLineKind.meta;

    return Container(
      color: bg,
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (showGutter)
            Container(
              decoration: BoxDecoration(
                color: ocTheme.backgroundElement,
                borderRadius: BorderRadius.circular(8),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: DefaultTextStyle(
                style: GoogleFonts.jetBrainsMono(
                  fontSize: fontSize - 1,
                  color: ocTheme.textMuted,
                  height: 1.4,
                ),
                child: Row(
                  children: [
                    SizedBox(
                      width: (gutterDigits * (fontSize - 1) * 0.62).clamp(
                        14.0,
                        60.0,
                      ),
                      child: Text(
                        line.oldLine?.toString() ?? '',
                        textAlign: TextAlign.right,
                      ),
                    ),
                    const SizedBox(width: 10),
                    SizedBox(
                      width: (gutterDigits * (fontSize - 1) * 0.62).clamp(
                        14.0,
                        60.0,
                      ),
                      child: Text(
                        line.newLine?.toString() ?? '',
                        textAlign: TextAlign.right,
                      ),
                    ),
                  ],
                ),
              ),
            )
          else
            const SizedBox(width: 0),
          if (showGutter) const SizedBox(width: 10),
          Expanded(
            child: Text(
              line.text,
              style: GoogleFonts.jetBrainsMono(
                fontSize: fontSize,
                color: fg,
                height: 1.6,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _background(DiffLineKind kind, OpenCodeTheme ocTheme) {
    switch (kind) {
      case DiffLineKind.added:
        return ocTheme.success.withValues(alpha: 0.10);
      case DiffLineKind.removed:
        return ocTheme.error.withValues(alpha: 0.10);
      case DiffLineKind.hunk:
      case DiffLineKind.header:
      case DiffLineKind.meta:
        return Colors.transparent;
      case DiffLineKind.context:
        return Colors.transparent;
    }
  }

  Color _foreground(DiffLineKind kind, OpenCodeTheme ocTheme) {
    switch (kind) {
      case DiffLineKind.added:
        return ocTheme.success;
      case DiffLineKind.removed:
        return ocTheme.error;
      case DiffLineKind.hunk:
      case DiffLineKind.header:
      case DiffLineKind.meta:
        return ocTheme.textMuted;
      case DiffLineKind.context:
        return ocTheme.text;
    }
  }
}
