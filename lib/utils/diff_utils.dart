import 'dart:math';

enum DiffLineKind { header, hunk, context, added, removed, meta }

class DiffLine {
  const DiffLine({
    required this.kind,
    required this.text,
    this.oldLine,
    this.newLine,
  });

  final DiffLineKind kind;
  final String text;
  final int? oldLine;
  final int? newLine;
}

class UnifiedDiff {
  const UnifiedDiff._();

  static String generate({
    required String filePath,
    required String before,
    required String after,
    int contextLines = 3,
  }) {
    final beforeLines = _splitLines(before);
    final afterLines = _splitLines(after);
    final ops = _myers(beforeLines, afterLines);
    final hunks = _buildHunks(ops, contextLines: contextLines);

    final buffer = StringBuffer()
      ..writeln('--- $filePath')
      ..writeln('+++ $filePath');

    for (final hunk in hunks) {
      buffer.writeln(
        '@@ -${hunk.oldStart},${hunk.oldLength} +${hunk.newStart},${hunk.newLength} @@',
      );
      for (final line in hunk.lines) {
        buffer.writeln('${line.prefix}${line.text}');
      }
    }

    return buffer.toString().trimRight();
  }

  static List<DiffLine> parse(String unifiedDiffText) {
    var oldLine = 0;
    var newLine = 0;
    var inHunk = false;

    final result = <DiffLine>[];
    for (final rawLine in _splitLines(unifiedDiffText)) {
      if (rawLine.startsWith('--- ') || rawLine.startsWith('+++ ')) {
        result.add(DiffLine(kind: DiffLineKind.header, text: rawLine));
        continue;
      }
      if (rawLine.startsWith('@@')) {
        final parsed = _parseHunkHeader(rawLine);
        if (parsed != null) {
          oldLine = parsed.oldStart;
          newLine = parsed.newStart;
          inHunk = true;
        } else {
          inHunk = false;
        }
        result.add(DiffLine(kind: DiffLineKind.hunk, text: rawLine));
        continue;
      }

      if (!inHunk) {
        result.add(DiffLine(kind: DiffLineKind.meta, text: rawLine));
        continue;
      }

      if (rawLine.isEmpty) {
        result.add(
          DiffLine(kind: DiffLineKind.context, text: rawLine, oldLine: oldLine, newLine: newLine),
        );
        oldLine++;
        newLine++;
        continue;
      }

      final prefix = rawLine[0];
      final content = rawLine.substring(1);

      switch (prefix) {
        case ' ':
          result.add(
            DiffLine(
              kind: DiffLineKind.context,
              text: content,
              oldLine: oldLine,
              newLine: newLine,
            ),
          );
          oldLine++;
          newLine++;
          break;
        case '-':
          // Skip header line already handled above.
          result.add(
            DiffLine(
              kind: DiffLineKind.removed,
              text: content,
              oldLine: oldLine,
              newLine: null,
            ),
          );
          oldLine++;
          break;
        case '+':
          result.add(
            DiffLine(
              kind: DiffLineKind.added,
              text: content,
              oldLine: null,
              newLine: newLine,
            ),
          );
          newLine++;
          break;
        default:
          result.add(DiffLine(kind: DiffLineKind.meta, text: rawLine));
          break;
      }
    }

    return result;
  }

  static List<String> _splitLines(String input) {
    // Preserve empty final line behavior consistently.
    final normalized = input.replaceAll('\r\n', '\n');
    return normalized.split('\n');
  }

  static _HunkHeader? _parseHunkHeader(String header) {
    // Format: @@ -oldStart,oldLen +newStart,newLen @@
    final match = RegExp(r'^@@\s+-([0-9]+)(?:,([0-9]+))?\s+\+([0-9]+)(?:,([0-9]+))?\s+@@')
        .firstMatch(header);
    if (match == null) return null;
    return _HunkHeader(
      oldStart: int.parse(match.group(1)!),
      oldLength: int.parse(match.group(2) ?? '1'),
      newStart: int.parse(match.group(3)!),
      newLength: int.parse(match.group(4) ?? '1'),
    );
  }
}

class _HunkHeader {
  const _HunkHeader({
    required this.oldStart,
    required this.oldLength,
    required this.newStart,
    required this.newLength,
  });

  final int oldStart;
  final int oldLength;
  final int newStart;
  final int newLength;
}

enum _OpKind { equal, insert, delete }

class _Op {
  const _Op(this.kind, this.text);

  final _OpKind kind;
  final String text;
}

class _HunkLine {
  const _HunkLine({
    required this.prefix,
    required this.text,
    required this.oldLineStart,
    required this.newLineStart,
    required this.kind,
  });

  final String prefix;
  final String text;
  final int oldLineStart;
  final int newLineStart;
  final _OpKind kind;
}

class _Hunk {
  const _Hunk({
    required this.oldStart,
    required this.oldLength,
    required this.newStart,
    required this.newLength,
    required this.lines,
  });

  final int oldStart;
  final int oldLength;
  final int newStart;
  final int newLength;
  final List<_HunkLine> lines;
}

List<_Hunk> _buildHunks(List<_Op> ops, {required int contextLines}) {
  // Convert ops -> per-line with tracking positions for hunk header.
  final all = <_HunkLine>[];
  var oldLine = 1;
  var newLine = 1;

  for (final op in ops) {
    final startOld = oldLine;
    final startNew = newLine;
    switch (op.kind) {
      case _OpKind.equal:
        all.add(
          _HunkLine(
            prefix: ' ',
            text: op.text,
            oldLineStart: startOld,
            newLineStart: startNew,
            kind: op.kind,
          ),
        );
        oldLine++;
        newLine++;
        break;
      case _OpKind.delete:
        all.add(
          _HunkLine(
            prefix: '-',
            text: op.text,
            oldLineStart: startOld,
            newLineStart: startNew,
            kind: op.kind,
          ),
        );
        oldLine++;
        break;
      case _OpKind.insert:
        all.add(
          _HunkLine(
            prefix: '+',
            text: op.text,
            oldLineStart: startOld,
            newLineStart: startNew,
            kind: op.kind,
          ),
        );
        newLine++;
        break;
    }
  }

  final changeIndices = <int>[];
  for (var i = 0; i < all.length; i++) {
    if (all[i].kind != _OpKind.equal) changeIndices.add(i);
  }
  if (changeIndices.isEmpty) return const [];

  final hunks = <_Hunk>[];
  var cursor = 0;
  while (cursor < all.length) {
    var nextChange = -1;
    for (final idx in changeIndices) {
      if (idx >= cursor) {
        nextChange = idx;
        break;
      }
    }
    if (nextChange == -1) break;

    final start = max(nextChange - contextLines, 0);

    var lastChange = nextChange;
    var i = nextChange + 1;
    while (i < all.length) {
      if (all[i].kind != _OpKind.equal) {
        lastChange = i;
      }
      if (i - lastChange > contextLines) break;
      i++;
    }
    final endExclusive = min(lastChange + contextLines + 1, all.length);

    final slice = all.sublist(start, endExclusive);
    final oldStart = slice.first.oldLineStart;
    final newStart = slice.first.newLineStart;
    var oldLen = 0;
    var newLen = 0;
    for (final line in slice) {
      if (line.kind != _OpKind.insert) oldLen++;
      if (line.kind != _OpKind.delete) newLen++;
    }

    hunks.add(
      _Hunk(
        oldStart: oldStart,
        oldLength: oldLen,
        newStart: newStart,
        newLength: newLen,
        lines: slice,
      ),
    );

    cursor = endExclusive;
  }

  return hunks;
}

List<_Op> _myers(List<String> a, List<String> b) {
  final n = a.length;
  final m = b.length;
  final maxD = n + m;

  final v = <int, int>{1: 0};
  final trace = <Map<int, int>>[];

  for (var d = 0; d <= maxD; d++) {
    trace.add(Map<int, int>.from(v));
    for (var k = -d; k <= d; k += 2) {
      final down = k == -d ||
          (k != d && (v[k - 1] ?? 0) < (v[k + 1] ?? 0));
      var x = down ? (v[k + 1] ?? 0) : (v[k - 1] ?? 0) + 1;
      var y = x - k;

      while (x < n && y < m && a[x] == b[y]) {
        x++;
        y++;
      }

      v[k] = x;

      if (x >= n && y >= m) {
        return _backtrack(trace, a, b, n, m);
      }
    }
  }

  return _backtrack(trace, a, b, n, m);
}

List<_Op> _backtrack(
  List<Map<int, int>> trace,
  List<String> a,
  List<String> b,
  int n,
  int m,
) {
  var x = n;
  var y = m;
  final result = <_Op>[];

  for (var d = trace.length - 1; d >= 0; d--) {
    final v = trace[d];
    final k = x - y;

    int prevK;
    final down = k == -d || (k != d && (v[k - 1] ?? 0) < (v[k + 1] ?? 0));
    prevK = down ? k + 1 : k - 1;

    final prevX = v[prevK] ?? 0;
    final prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      result.add(_Op(_OpKind.equal, a[x - 1]));
      x--;
      y--;
    }

    if (d == 0) break;

    if (x == prevX) {
      result.add(_Op(_OpKind.insert, b[y - 1]));
      y--;
    } else {
      result.add(_Op(_OpKind.delete, a[x - 1]));
      x--;
    }
  }

  return result.reversed.toList(growable: false);
}

