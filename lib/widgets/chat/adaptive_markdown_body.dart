import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/ansi_escape.dart';
import 'package:broski/widgets/chat/adaptive_table.dart';
import 'package:broski/widgets/chat/mermaid_block.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';

/// The type of a parsed markdown segment.
enum _SegmentType { text, table, mermaid }

/// A segment of markdown content — regular text, a table, or a mermaid block.
class _Segment {
  const _Segment(this.content, {required this.type});
  final String content;
  final _SegmentType type;
}

/// Drop-in replacement for [MarkdownBody] that renders GFM tables with
/// content-aware adaptive column widths and mermaid code blocks with
/// [MermaidBlock].
///
/// Non-table/non-mermaid content is passed through to the standard
/// [MarkdownBody]. Table blocks are extracted and rendered with
/// [AdaptiveTable], which sizes columns proportionally based on content
/// (Pi-style algorithm) so icon/symbol columns stay narrow and text
/// columns get the space they need — critical for mobile screens.
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
    final clean = stripAnsi(data);
    final segments = _splitSegments(clean);

    // Fast path: single text segment — use standard MarkdownBody as-is.
    if (segments.length == 1 && segments.first.type == _SegmentType.text) {
      return MarkdownBody(
        data: clean,
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
      switch (seg.type) {
        case _SegmentType.table:
          widgets.add(AdaptiveTable(markdown: seg.content, theme: theme));
        case _SegmentType.mermaid:
          widgets.add(MermaidBlock(code: seg.content));
        case _SegmentType.text:
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
  // Markdown segment splitter (tables + mermaid)
  // ---------------------------------------------------------------------------

  /// Splits markdown text at GFM table and mermaid code block boundaries.
  ///
  /// Returns a list of segments where each is regular markdown text,
  /// a complete GFM table block, or the body of a mermaid code fence.
  /// Non-mermaid code-fenced blocks are left intact for [MarkdownBody].
  static List<_Segment> _splitSegments(String markdown) {
    final lines = markdown.split('\n');
    final segments = <_Segment>[];
    final buffer = StringBuffer();
    String? fenceMarker; // non-null = inside a non-mermaid code fence
    int i = 0;

    while (i < lines.length) {
      final line = lines[i];
      final trimmed = line.trim();

      // --- Mermaid fence detection (must come before generic fence tracking) ---
      if (fenceMarker == null && _isMermaidFenceOpen(trimmed)) {
        _flushText(buffer, segments);
        final mermaidBuf = StringBuffer();
        i++; // skip the opening ```mermaid line
        while (i < lines.length) {
          final mLine = lines[i].trim();
          if (mLine.startsWith('```')) {
            i++; // skip closing ```
            break;
          }
          mermaidBuf.writeln(lines[i]);
          i++;
        }
        final code = mermaidBuf.toString().trimRight();
        if (code.isNotEmpty) {
          segments.add(_Segment(code, type: _SegmentType.mermaid));
        }
        continue;
      }

      // --- Generic code fence tracking (skip non-mermaid fenced blocks) ---
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        final marker = trimmed.startsWith('```') ? '```' : '~~~';
        if (fenceMarker == null) {
          fenceMarker = marker; // opening
        } else if (trimmed.startsWith(fenceMarker)) {
          fenceMarker = null; // matching close
        }
        buffer.writeln(line);
        i++;
        continue;
      }

      if (fenceMarker != null) {
        buffer.writeln(line);
        i++;
        continue;
      }

      // --- Table detection ---
      if (_looksLikeTableRow(trimmed) &&
          i + 1 < lines.length &&
          _isSeparatorRow(lines[i + 1].trim())) {
        _flushText(buffer, segments);

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

        segments.add(
          _Segment(tableBuf.toString().trimRight(), type: _SegmentType.table),
        );
        continue;
      }

      buffer.writeln(line);
      i++;
    }

    _flushText(buffer, segments);
    return segments.isEmpty
        ? [_Segment(markdown, type: _SegmentType.text)]
        : segments;
  }

  /// Returns true if [trimmed] is a mermaid fence opener like ```mermaid.
  static bool _isMermaidFenceOpen(String trimmed) {
    if (!trimmed.startsWith('```')) return false;
    final lang = trimmed.substring(3).trim().toLowerCase();
    return lang == 'mermaid';
  }

  static void _flushText(StringBuffer buffer, List<_Segment> segments) {
    final text = buffer.toString().trimRight();
    if (text.isNotEmpty) {
      segments.add(_Segment(text, type: _SegmentType.text));
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
