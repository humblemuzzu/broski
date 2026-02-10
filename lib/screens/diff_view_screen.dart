
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../models/message.dart';
import '../theme/opencode_theme.dart';
import '../utils/diff_utils.dart';
import 'package:broski/theme/app_icons.dart';
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
    final maxNew = _maxLine(_lines.map((l) => l.newLine));
    final gutterDigits = _digits(maxNew);
    // Filter out metadata lines for cleaner view
    final contentLines = _lines
        .where(
          (l) => l.kind != DiffLineKind.header && l.kind != DiffLineKind.meta,
        )
        .toList();
    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.background,
        foregroundColor: ocTheme.text,
        elevation: 0,
        titleSpacing: 0,
        title: Row(
          children: [
            Flexible(
              child: Text(
                fileName,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            SizedBox(width: Spacing.md),
            // Inline stats
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
              const SizedBox(width: 6),
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
        actions: [
          IconButton(
            tooltip: 'Copy diff',
            onPressed: () => _copy(context),
            icon: Icon(AppIcons.copy, size: 20, color: ocTheme.textMuted),
          ),
          IconButton(
            tooltip: 'Reset zoom',
            onPressed: () => setState(() => _fontSize = 12.5),
            icon: Icon(
              AppIcons.textFields,
              size: 20,
              color: ocTheme.textMuted,
            ),
          ),
          if (canUndo)
            IconButton(
              tooltip: 'Undo',
              onPressed: () =>
                  widget.onUndo!(widget.messageId!, widget.diff.partId!),
              icon: Icon(AppIcons.undo, size: 20, color: ocTheme.warning),
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
          margin: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          decoration: BoxDecoration(
            color: ocTheme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(color: ocTheme.borderSubtle),
          ),
          clipBehavior: Clip.antiAlias,
          child: ListView.builder(
            padding: Insets.chipV,
            itemCount: contentLines.length,
            itemBuilder: (context, index) {
              final line = contentLines[index];
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
    final showGutter = line.kind != DiffLineKind.hunk;
    final isHunk = line.kind == DiffLineKind.hunk;
    // For hunk lines, show them muted and compact
    if (isHunk) {
      return Container(
        color: Colors.transparent,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
        child: Text(
          line.text,
          style: AppTypography.code(color: ocTheme.textMuted.withValues(alpha: 0.5)).copyWith(
            fontSize: fontSize - 2,
            height: 1.4,
          ),
        ),
      );
    }
    // Prefix character for added/removed lines
    final prefix = switch (line.kind) {
      DiffLineKind.added => '+',
      DiffLineKind.removed => '-',
      _ => ' ',
    };
    return Container(
      color: bg,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 1),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Single line number column - compact, muted
          if (showGutter)
            SizedBox(
              width: (gutterDigits * 7.0).clamp(20.0, 40.0),
              child: Text(
                line.newLine?.toString() ?? '',
                textAlign: TextAlign.right,
                style: AppTypography.code(color: ocTheme.textMuted.withValues(alpha: 0.4)).copyWith(
                  fontSize: fontSize - 2,
                  height: 1.6,
                ),
              ),
            ),
          if (showGutter) SizedBox(width: Spacing.sm),
          // Prefix (+/-/space)
          Text(
            prefix,
            style: AppTypography.code(color: fg.withValues(alpha: 0.7)).copyWith(
              fontSize: fontSize,
              height: 1.6,
            ),
          ),
          SizedBox(width: Spacing.xs),
          // Content
          Expanded(
            child: Text(
              line.text,
              style: AppTypography.code(color: fg).copyWith(
                fontSize: fontSize,
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
        return ocTheme.success.withValues(alpha: 0.08);
      case DiffLineKind.removed:
        return ocTheme.error.withValues(alpha: 0.08);
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
        return ocTheme.text.withValues(alpha: 0.8);
    }
  }
}
