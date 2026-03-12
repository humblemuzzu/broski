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

    // Measure natural (max content) and minimum (longest-segment) widths,
    // plus total content volume per column for weighting.
    final natural = List<double>.filled(n, 0);
    final minWord = List<double>.filled(n, _minColW);
    final volume = List<double>.filled(n, 0);

    for (int col = 0; col < n; col++) {
      final hdr = _stripInline(table.headers[col]);
      natural[col] = _measure(hdr, _headerStyle);
      minWord[col] = max(_minColW, _longestSegment(hdr, _headerStyle));
      volume[col] += hdr.length;

      for (final row in table.rows) {
        final cell = col < row.length ? _stripInline(row[col]) : '';
        natural[col] = max(natural[col], _measure(cell, _bodyStyle));
        minWord[col] = max(minWord[col], _longestSegment(cell, _bodyStyle));
        volume[col] += cell.length;
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
    final forContent = max(0.0, available - borderOverhead - padOverhead);
    final totalNatural = natural.reduce((a, b) => a + b);

    // Cap each column's minimum so no single column can hog the table.
    // At most 45% for 2 columns, 35% for 3+.
    final maxMinFraction = n <= 2 ? 0.45 : 0.35;
    final maxMinW = forContent * maxMinFraction;
    for (int i = 0; i < n; i++) {
      minWord[i] = min(minWord[i], maxMinW);
    }

    List<double> colW;
    bool scroll = false;

    if (totalNatural <= forContent) {
      // Everything fits — give leftover weighted by content volume.
      colW = List<double>.from(natural);
      final textCols = <int>[
        for (int i = 0; i < n; i++)
          if (!isCompact[i]) i,
      ];
      final leftover = forContent - totalNatural;
      if (textCols.isNotEmpty && leftover > 0) {
        final textVolume =
            textCols.map((i) => volume[i]).reduce((a, b) => a + b);
        for (final i in textCols) {
          final share = textVolume > 0
              ? (volume[i] / textVolume) * leftover
              : leftover / textCols.length;
          colW[i] += share;
        }
      }
    } else {
      // Shrink — distribute space above minimums using a blend of
      // growth margin (how much the column wants to grow) and content
      // volume (how much text actually needs to be displayed).
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
        final totalVol = volume.reduce((a, b) => a + b);

        // Blend: 50% growth-based, 50% volume-based.
        final blended = List.generate(n, (i) {
          final gShare =
              totalGrow > 0 ? growths[i] / totalGrow : 1.0 / n;
          final vShare =
              totalVol > 0 ? volume[i] / totalVol : 1.0 / n;
          return (gShare + vShare) / 2;
        });
        final totalBlended = blended.reduce((a, b) => a + b);

        colW = List.generate(n, (i) {
          final bonus = totalBlended > 0
              ? (blended[i] / totalBlended) * extra
              : extra / n;
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

  /// Insert zero-width spaces after path separators so Flutter's text
  /// layout can break long file paths at directory boundaries.
  /// Only `/` and `\` — NOT `_` or `-` which appear in prose, CLI flags,
  /// and compound words where invisible chars corrupt clipboard copies.
  static String _addBreakHints(String text) {
    return text
        .replaceAll('/', '/\u200B')
        .replaceAll('\\', '\\\u200B');
  }

  List<InlineSpan> _nodesToSpans(List<md.Node> nodes, TextStyle style) {
    final spans = <InlineSpan>[];
    for (final node in nodes) {
      if (node is md.Text) {
        spans.add(TextSpan(text: _addBreakHints(node.text), style: style));
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
              text: node.textContent, // verbatim — no break hints in code
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

  /// Longest unbreakable segment width — splits on whitespace AND
  /// code-friendly delimiters (/, \, _, -) so file paths like
  /// "lib/screens/sheets/cx_settings_sheet.dart" break into smaller
  /// segments instead of being treated as one 280px word.
  ///
  /// Intentionally more aggressive than [_addBreakHints] (which only
  /// inserts break hints at / and \ to avoid clipboard corruption).
  /// The mismatch is fine: this is a width-allocation heuristic, not
  /// a rendering promise. Flutter wraps at character boundaries when
  /// a word exceeds column width, so the text still fits.
  double _longestSegment(String text, TextStyle style) {
    if (text.isEmpty) return _minColW;
    final segments = text.split(RegExp(r'[\s/\\_-]+'));
    double longest = _minColW;
    for (final seg in segments) {
      if (seg.isEmpty) continue;
      longest = max(longest, min(_measure(seg, style), 200));
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
