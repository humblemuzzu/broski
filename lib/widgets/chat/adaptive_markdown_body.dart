import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

import '../../theme/opencode_theme.dart';
import 'adaptive_table.dart';

/// A segment of markdown content — either regular text or a table block.
class _Segment {
  const _Segment(this.content, {required this.isTable});
  final String content;
  final bool isTable;
}

/// Drop-in replacement for [MarkdownBody] that renders GFM tables with
/// content-aware adaptive column widths.
///
/// Non-table content is passed through to the standard [MarkdownBody].
/// Table blocks are extracted and rendered with [AdaptiveTable], which
/// sizes columns proportionally based on content (Pi-style algorithm)
/// so icon/symbol columns stay narrow and text columns get the space
/// they need — critical for mobile screens.
class AdaptiveMarkdownBody extends StatelessWidget {
  const AdaptiveMarkdownBody({
    super.key,
    required this.data,
    this.selectable = false,
    this.styleSheet,
    this.onTapLink,
    this.fitContent = false,
  });

  final String data;
  final bool selectable;
  final MarkdownStyleSheet? styleSheet;
  final MarkdownTapLinkCallback? onTapLink;
  final bool fitContent;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final segments = _splitAtTables(data);

    // Fast path: no tables found — use standard MarkdownBody as-is.
    if (segments.length == 1 && !segments.first.isTable) {
      return MarkdownBody(
        data: data,
        selectable: selectable,
        styleSheet: styleSheet,
        onTapLink: onTapLink,
        fitContent: fitContent,
      );
    }

    final blockSpacing = styleSheet?.blockSpacing ?? 16.0;

    return Column(
      crossAxisAlignment: fitContent
          ? CrossAxisAlignment.start
          : CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: _buildChildren(segments, theme, blockSpacing),
    );
  }

  List<Widget> _buildChildren(
    List<_Segment> segments,
    OpenCodeTheme theme,
    double spacing,
  ) {
    final widgets = <Widget>[];
    for (int i = 0; i < segments.length; i++) {
      if (i > 0) {
        widgets.add(SizedBox(height: spacing));
      }
      final seg = segments[i];
      if (seg.isTable) {
        widgets.add(AdaptiveTable(markdown: seg.content, theme: theme));
      } else {
        widgets.add(
          MarkdownBody(
            data: seg.content,
            selectable: selectable,
            styleSheet: styleSheet,
            onTapLink: onTapLink,
            fitContent: fitContent,
          ),
        );
      }
    }
    return widgets;
  }

  // ---------------------------------------------------------------------------
  // Markdown table splitter
  // ---------------------------------------------------------------------------

  /// Splits markdown text at GFM table boundaries.
  ///
  /// Returns a list of segments where each is either regular markdown text
  /// or a complete GFM table block (header + separator + data rows).
  /// Code-fenced blocks are skipped to avoid false positives.
  static List<_Segment> _splitAtTables(String markdown) {
    final lines = markdown.split('\n');
    final segments = <_Segment>[];
    final buffer = StringBuffer();
    String? fenceMarker; // non-null = inside a code fence
    int i = 0;

    while (i < lines.length) {
      final line = lines[i];
      final trimmed = line.trim();

      // Track fenced code blocks — never parse tables inside them.
      // A fence opened with ``` can only be closed by ```, same for ~~~.
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        final marker = trimmed.startsWith('```') ? '```' : '~~~';
        if (fenceMarker == null) {
          fenceMarker = marker; // opening
        } else if (trimmed.startsWith(fenceMarker)) {
          fenceMarker = null; // matching close
        }
        // else: different marker inside fence — treat as code content
        buffer.writeln(line);
        i++;
        continue;
      }

      if (fenceMarker != null) {
        buffer.writeln(line);
        i++;
        continue;
      }

      // Detect table: current line looks like a table row AND the next line
      // is a valid GFM separator row (e.g. "| --- | :---: | ---: |").
      if (_looksLikeTableRow(trimmed) &&
          i + 1 < lines.length &&
          _isSeparatorRow(lines[i + 1].trim())) {
        // Flush accumulated text.
        _flushText(buffer, segments);

        // Collect the entire table block. A blank line or non-table line
        // terminates the table (matching GFM semantics).
        final tableBuf = StringBuffer();
        tableBuf.writeln(line); // header
        i++;
        tableBuf.writeln(lines[i]); // separator
        i++;
        while (i < lines.length) {
          final candidate = lines[i].trim();
          if (candidate.isEmpty || !_looksLikeTableRow(candidate)) break;
          tableBuf.writeln(lines[i]);
          i++;
        }

        segments.add(_Segment(tableBuf.toString().trimRight(), isTable: true));
        continue;
      }

      buffer.writeln(line);
      i++;
    }

    _flushText(buffer, segments);
    return segments.isEmpty ? [_Segment(markdown, isTable: false)] : segments;
  }

  static void _flushText(StringBuffer buffer, List<_Segment> segments) {
    final text = buffer.toString().trimRight();
    if (text.isNotEmpty) {
      segments.add(_Segment(text, isTable: false));
    }
    buffer.clear();
  }

  /// Quick heuristic: a table row contains `|` and has non-empty content
  /// between at least one pair of pipes.
  static bool _looksLikeTableRow(String line) {
    if (!line.contains('|')) return false;
    return line.split('|').any((p) => p.trim().isNotEmpty);
  }

  /// A separator row has cells matching `:?-+:?` (GFM alignment syntax).
  static bool _isSeparatorRow(String line) {
    if (!line.contains('|') || !line.contains('-')) return false;
    var cells = line.split('|');
    if (cells.first.trim().isEmpty) cells = cells.sublist(1);
    if (cells.isNotEmpty && cells.last.trim().isEmpty) {
      cells = cells.sublist(0, cells.length - 1);
    }
    if (cells.isEmpty) return false;
    return cells.every((c) => RegExp(r'^:?-+:?$').hasMatch(c.trim()));
  }
}
