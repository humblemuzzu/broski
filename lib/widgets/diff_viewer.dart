import 'package:broski/models/message.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/diff_utils.dart';
import 'package:broski/widgets/diff_status_badge.dart';
import 'package:flutter/material.dart';

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
      borderRadius: Radii.brLg,
      child: Container(
        margin: Insets.topSm,
        padding: Insets.cardMd,
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: Radii.brLg,
          border: Border.all(color: theme.borderSubtle, width: 1),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header - compact
            Row(
              children: [
                Container(
                  padding: Insets.cardXs,
                  decoration: BoxDecoration(
                    color: theme.borderSubtle.withValues(alpha: 0.5),
                    borderRadius: Radii.brSm,
                  ),
                  child: Icon(AppIcons.code, size: 16, color: theme.textMuted),
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
                      const SizedBox(width: Spacing.sm),
                      if (widget.diff.status != null &&
                          widget.diff.status!.isNotEmpty) ...[
                        DiffStatusBadge(status: widget.diff.status),
                        const SizedBox(width: 6),
                      ],
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
                        const SizedBox(width: Spacing.xs),
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
                  _isExpanded ? AppIcons.chevronUp : AppIcons.chevronDown,
                  color: theme.textMuted.withValues(alpha: 0.6),
                  size: 20,
                ),
              ],
            ),
            // Expanded diff content
            const SizedBox(height: Spacing.md),
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
                      icon: Icon(AppIcons.undo, size: 13, color: theme.warning),
                      label: Text(
                        'Undo',
                        style: AppTypography.label(color: theme.warning),
                      ),
                      style: TextButton.styleFrom(
                        padding: Insets.chipH,
                        minimumSize: Size.zero,
                        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    ),
                  const Spacer(),
                  TextButton.icon(
                    onPressed: widget.onViewFull,
                    icon: Icon(AppIcons.expand, size: 13, color: theme.info),
                    label: Text(
                      'View full',
                      style: TextStyle(
                        fontSize: 12,
                        color: theme.info,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                    style: TextButton.styleFrom(
                      padding: Insets.chipH,
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

class _DiffPreview extends StatefulWidget {
  const _DiffPreview({required this.diff, required this.maxLines});
  final DiffEntry diff;
  final int maxLines;
  @override
  State<_DiffPreview> createState() => _DiffPreviewState();
}

class _DiffPreviewState extends State<_DiffPreview> {
  String? _lastDiffText;
  List<DiffLine> _contentLines = const [];
  @override
  void initState() {
    super.initState();
    _recompute();
  }

  @override
  void didUpdateWidget(covariant _DiffPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.diff != widget.diff) {
      _recompute();
    } else if (oldWidget.maxLines != widget.maxLines) {
      // No-op: we slice from cached lines in build().
    }
  }

  String _computeDiffText() {
    final diff = widget.diff;
    return (diff.diff != null && diff.diff!.trim().isNotEmpty)
        ? diff.diff!
        : UnifiedDiff.generate(
            filePath: diff.file.isNotEmpty ? diff.file : 'file',
            before: diff.before,
            after: diff.after,
          );
  }

  void _recompute() {
    final diffText = _computeDiffText();
    if (diffText == _lastDiffText) return;
    _lastDiffText = diffText;
    final parsed = UnifiedDiff.parse(diffText);
    final contentLines = <DiffLine>[];
    for (final line in parsed) {
      if (line.kind == DiffLineKind.header ||
          line.kind == DiffLineKind.hunk ||
          line.kind == DiffLineKind.meta) {
        continue;
      }
      contentLines.add(line);
    }
    _contentLines = contentLines;
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final previewLines = _contentLines.take(widget.maxLines).toList();
    return Container(
      width: double.infinity,
      padding: Insets.cardXs,
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: previewLines.isEmpty
          ? Text(
              'No preview available',
              style: AppTypography.codeSmall(
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
      padding: Insets.chip,
      decoration: BoxDecoration(color: bg, borderRadius: Radii.brSm),
      child: Text(
        '$prefix ${line.text.isEmpty ? ' ' : line.text}',
        style: AppTypography.codeSmall(color: fg).copyWith(height: 1.4),
      ),
    );
  }
}
