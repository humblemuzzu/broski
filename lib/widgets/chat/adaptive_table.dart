import 'dart:math';

import 'package:flutter/material.dart';
import 'package:markdown/markdown.dart' as md;

import '../../theme/app_typography.dart';
import '../../theme/opencode_theme.dart';

class _ParsedTable {
  const _ParsedTable(this.headers, this.rows, this.alignments);
  final List<String> headers;
  final List<List<String>> rows;
  final List<TextAlign> alignments;
  int get columnCount => headers.length;
}

class _ColumnLayout {
  const _ColumnLayout(this.widths, this.totalWidth, this.needsScroll, this.isCompact);
  final Map<int, TableColumnWidth> widths;
  final double totalWidth;
  final bool needsScroll;
  final List<bool> isCompact; // true = icon/short content column
}

/// Renders a GFM markdown table with content-aware column widths.
///
/// Pi-style proportional sizing: measures each column's natural and minimum
/// (longest-word) widths, keeps icon columns compact, distributes remaining
/// space to text columns, and scrolls horizontally only when truly needed.
class AdaptiveTable extends StatelessWidget {
  const AdaptiveTable({
    super.key,
    required this.markdown,
    required this.theme,
  });

  final String markdown;
  final OpenCodeTheme theme;

  static const double _borderW = 1.0;
  static const double _padH = 8.0;
  static const double _padV = 6.0;
  static const double _compactPadH = 5.0;
  static const double _minColW = 20.0;

  @override
  Widget build(BuildContext context) {
    // Parse once outside LayoutBuilder — only width calculation needs
    // to re-run when constraints change.
    final parsed = _parseGfmTable(markdown);
    if (parsed == null) {
      return Text(markdown, style: _bodyStyle);
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final available = constraints.maxWidth;
        final layout = _calcWidths(parsed, available);

        final table = Table(
          columnWidths: layout.widths,
          border: TableBorder.all(
            color: theme.borderSubtle,
            width: _borderW,
          ),
          defaultVerticalAlignment: TableCellVerticalAlignment.top,
          children: [
            _headerRow(parsed, layout),
            ...List.generate(
              parsed.rows.length,
              (i) => _dataRow(parsed.rows[i], parsed, layout),
            ),
          ],
        );

        if (layout.needsScroll) {
          return SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: ConstrainedBox(
              constraints: BoxConstraints(minWidth: layout.totalWidth),
              child: table,
            ),
          );
        }

        return table;
      },
    );
  }

  TextStyle get _headerStyle => TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      );

  TextStyle get _bodyStyle => TextStyle(
        fontFamily: AppTypography.uiFontFamily,
        fontSize: 14,
        color: theme.text,
        height: 1.5,
      );

  _ColumnLayout _calcWidths(_ParsedTable table, double available) {
    final n = table.columnCount;
    final borderOverhead = _borderW * (n + 1);

    // Measure natural (max content) and minimum (longest word) widths.
    final natural = List<double>.filled(n, 0);
    final minWord = List<double>.filled(n, _minColW);

    for (int col = 0; col < n; col++) {
      final hdr = _stripInline(table.headers[col]);
      natural[col] = _measure(hdr, _headerStyle);
      minWord[col] = max(_minColW, _longestWord(hdr, _headerStyle));

      for (final row in table.rows) {
        final cell = col < row.length ? _stripInline(row[col]) : '';
        natural[col] = max(natural[col], _measure(cell, _bodyStyle));
        minWord[col] = max(minWord[col], _longestWord(cell, _bodyStyle));
      }
    }

    // Classify columns: compact if widest content ≤ 36px (icons, short tags).
    final isCompact = List<bool>.generate(n, (i) => natural[i] <= 36);

    // Per-column horizontal padding total (left + right).
    final pads = List<double>.generate(
      n,
      (i) => isCompact[i] ? _compactPadH * 2 : _padH * 2,
    );
    final padOverhead = pads.reduce((a, b) => a + b);
    final forContent = available - borderOverhead - padOverhead;
    final totalNatural = natural.reduce((a, b) => a + b);

    List<double> colW;
    bool scroll = false;

    if (totalNatural <= forContent) {
      // Everything fits — give leftover to text (non-compact) columns.
      colW = List<double>.from(natural);
      final textCols = <int>[
        for (int i = 0; i < n; i++)
          if (!isCompact[i]) i,
      ];
      final leftover = forContent - totalNatural;
      if (textCols.isNotEmpty && leftover > 0) {
        final share = leftover / textCols.length;
        for (final i in textCols) {
          colW[i] += share;
        }
      }
    } else {
      // Shrink — Pi's proportional distribution.
      final totalMin = minWord.reduce((a, b) => a + b);
      if (totalMin > forContent) {
        // Even minimums overflow — use minimums and scroll.
        colW = List<double>.from(minWord);
        scroll = true;
      } else {
        final extra = forContent - totalMin;
        final growths = List.generate(
          n,
          (i) => max(0.0, natural[i] - minWord[i]),
        );
        final totalGrow = growths.reduce((a, b) => a + b);
        colW = List.generate(n, (i) {
          final bonus =
              totalGrow > 0 ? (growths[i] / totalGrow) * extra : extra / n;
          return minWord[i] + bonus;
        });
      }
    }

    // Build width map — content width + padding per column.
    final widthMap = <int, TableColumnWidth>{};
    double total = borderOverhead;
    for (int i = 0; i < n; i++) {
      final w = colW[i] + pads[i];
      widthMap[i] = FixedColumnWidth(w);
      total += w;
    }

    return _ColumnLayout(widthMap, total, scroll, isCompact);
  }

  TableRow _headerRow(_ParsedTable table, _ColumnLayout layout) {
    return TableRow(
      decoration: BoxDecoration(
        color: theme.backgroundPanel.withValues(alpha: 0.5),
      ),
      children: List.generate(table.columnCount, (col) {
        final align = col < table.alignments.length
            ? table.alignments[col]
            : TextAlign.left;
        return _cell(
          table.headers[col],
          _headerStyle,
          align,
          compact: layout.isCompact[col],
        );
      }),
    );
  }

  TableRow _dataRow(
    List<String> row,
    _ParsedTable table,
    _ColumnLayout layout,
  ) {
    return TableRow(
      children: List.generate(table.columnCount, (col) {
        final text = col < row.length ? row[col] : '';
        final align = col < table.alignments.length
            ? table.alignments[col]
            : TextAlign.left;
        return _cell(text, _bodyStyle, align, compact: layout.isCompact[col]);
      }),
    );
  }

  Widget _cell(
    String text,
    TextStyle style,
    TextAlign align, {
    bool compact = false,
  }) {
    final hPad = compact ? _compactPadH : _padH;
    return TableCell(
      verticalAlignment: TableCellVerticalAlignment.top,
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: hPad, vertical: _padV),
        child: Text.rich(
          _inlineSpan(text, style),
          textAlign: align,
        ),
      ),
    );
  }

  TextSpan _inlineSpan(String text, TextStyle baseStyle) {
    if (text.isEmpty) return TextSpan(text: '', style: baseStyle);

    try {
      final doc = md.Document(
        encodeHtml: false,
        extensionSet: md.ExtensionSet.gitHubFlavored,
      );
      final nodes = doc.parseInline(text);
      final spans = _nodesToSpans(nodes, baseStyle);
      if (spans.isEmpty) return TextSpan(text: text, style: baseStyle);
      if (spans.length == 1 && spans.first is TextSpan) {
        return spans.first as TextSpan;
      }
      return TextSpan(children: spans, style: baseStyle);
    } catch (_) {
      return TextSpan(text: text, style: baseStyle);
    }
  }

  List<InlineSpan> _nodesToSpans(List<md.Node> nodes, TextStyle style) {
    final spans = <InlineSpan>[];
    for (final node in nodes) {
      if (node is md.Text) {
        spans.add(TextSpan(text: node.text, style: style));
      } else if (node is md.Element) {
        final children = node.children ?? [];
        switch (node.tag) {
          case 'strong':
            spans.addAll(_nodesToSpans(
              children,
              style.copyWith(
                fontWeight: FontWeight.w600,
                color: theme.markdownStrong,
              ),
            ));
          case 'em':
            spans.addAll(_nodesToSpans(
              children,
              style.copyWith(
                fontStyle: FontStyle.italic,
                color: theme.markdownEmph,
              ),
            ));
          case 'code':
            spans.add(TextSpan(
              text: node.textContent,
              style: AppTypography.codeSmall(color: theme.markdownCode)
                  .copyWith(backgroundColor: theme.backgroundElement),
            ));
          case 'del':
            spans.addAll(_nodesToSpans(
              children,
              style.copyWith(decoration: TextDecoration.lineThrough),
            ));
          case 'a':
            spans.add(TextSpan(
              text: node.textContent,
              style: style.copyWith(
                color: theme.markdownLink,
                decoration: TextDecoration.underline,
              ),
            ));
          default:
            spans.add(TextSpan(text: node.textContent, style: style));
        }
      }
    }
    return spans;
  }

  double _measure(String text, TextStyle style) {
    if (text.isEmpty) return 0;
    final painter = TextPainter(
      text: TextSpan(text: text, style: style),
      textDirection: TextDirection.ltr,
      maxLines: 1,
    )..layout();
    final w = painter.size.width;
    painter.dispose();
    return w;
  }

  double _longestWord(String text, TextStyle style) {
    if (text.isEmpty) return _minColW;
    final words = text.split(RegExp(r'\s+'));
    double longest = _minColW;
    for (final word in words) {
      if (word.isEmpty) continue;
      longest = max(longest, min(_measure(word, style), 200));
    }
    return longest;
  }

  static _ParsedTable? _parseGfmTable(String markdown) {
    final lines =
        markdown.split('\n').where((l) => l.trim().isNotEmpty).toList();
    if (lines.length < 2) return null;

    final headers = _parseRow(lines[0]);
    if (headers == null || headers.isEmpty) return null;

    final sepCells = _parseRow(lines[1]);
    if (sepCells == null || sepCells.isEmpty) return null;
    if (!sepCells.every((c) => RegExp(r'^:?-+:?$').hasMatch(c.trim()))) {
      return null;
    }

    // Alignments from separator row.
    final alignments = sepCells.map((c) {
      final t = c.trim();
      if (t.startsWith(':') && t.endsWith(':')) return TextAlign.center;
      if (t.endsWith(':')) return TextAlign.right;
      return TextAlign.left;
    }).toList();

    // Data rows — pad or truncate to header column count.
    final rows = <List<String>>[];
    for (int i = 2; i < lines.length; i++) {
      final cells = _parseRow(lines[i]);
      if (cells == null) continue;
      rows.add(List.generate(
        headers.length,
        (j) => j < cells.length ? cells[j] : '',
      ));
    }

    return _ParsedTable(headers, rows, alignments);
  }

  static List<String>? _parseRow(String line) {
    final trimmed = line.trim();
    if (!trimmed.contains('|')) return null;

    var cells = trimmed.split('|');
    // Remove empty head/tail from leading/trailing pipes.
    if (cells.first.trim().isEmpty) cells = cells.sublist(1);
    if (cells.isNotEmpty && cells.last.trim().isEmpty) {
      cells = cells.sublist(0, cells.length - 1);
    }
    if (cells.isEmpty) return null;
    return cells.map((c) => c.trim()).toList();
  }

  /// Strip inline markdown formatting for width measurement.
  static String _stripInline(String text) {
    return text
        .replaceAllMapped(RegExp(r'\*\*(.+?)\*\*'), (m) => m.group(1)!)
        .replaceAllMapped(RegExp(r'__(.+?)__'), (m) => m.group(1)!)
        .replaceAllMapped(RegExp(r'\*(.+?)\*'), (m) => m.group(1)!)
        .replaceAllMapped(RegExp(r'_(.+?)_'), (m) => m.group(1)!)
        .replaceAllMapped(RegExp(r'`(.+?)`'), (m) => m.group(1)!)
        .replaceAllMapped(RegExp(r'~~(.+?)~~'), (m) => m.group(1)!)
        .replaceAllMapped(RegExp(r'\[(.+?)\]\(.+?\)'), (m) => m.group(1)!);
  }
}
