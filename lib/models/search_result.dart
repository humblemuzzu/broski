/// Result from text search (ripgrep)
class TextSearchResult {
  final String path;
  final int lineNumber;
  final String lineText;
  final List<TextMatch> matches;

  const TextSearchResult({
    required this.path,
    required this.lineNumber,
    required this.lineText,
    required this.matches,
  });

  factory TextSearchResult.fromJson(Map<String, dynamic> json) {
    final matchesJson = json['matches'] as List<dynamic>? ?? [];
    return TextSearchResult(
      path: json['path'] as String? ?? '',
      lineNumber: json['lineNumber'] as int? ?? 0,
      lineText: json['lineText'] as String? ?? '',
      matches: matchesJson
          .map((m) => TextMatch.fromJson(m as Map<String, dynamic>))
          .toList(),
    );
  }

  /// Get filename from path
  String get filename => path.split('/').last;
}

/// A match within a text search result
class TextMatch {
  final String text;
  final int start;
  final int end;

  const TextMatch({required this.text, required this.start, required this.end});

  factory TextMatch.fromJson(Map<String, dynamic> json) {
    return TextMatch(
      text: json['text'] as String? ?? '',
      start: json['start'] as int? ?? 0,
      end: json['end'] as int? ?? 0,
    );
  }
}

/// Result from symbol search (LSP)
class SymbolResult {
  final String name;
  final String kind;
  final String path;
  final int line;
  final int column;

  const SymbolResult({
    required this.name,
    required this.kind,
    required this.path,
    required this.line,
    required this.column,
  });

  factory SymbolResult.fromJson(Map<String, dynamic> json) {
    return SymbolResult(
      name: json['name'] as String? ?? '',
      kind: json['kind'] as String? ?? 'unknown',
      path: json['path'] as String? ?? '',
      line: json['line'] as int? ?? 0,
      column: json['column'] as int? ?? 0,
    );
  }

  /// Get filename from path
  String get filename => path.split('/').last;

  /// Get a symbol icon based on kind
  String get icon {
    switch (kind.toLowerCase()) {
      case 'class':
        return 'C';
      case 'interface':
        return 'I';
      case 'function':
      case 'method':
        return 'f';
      case 'variable':
      case 'field':
        return 'v';
      case 'property':
        return 'p';
      case 'constant':
        return 'c';
      case 'enum':
        return 'E';
      case 'enummember':
        return 'e';
      case 'module':
      case 'namespace':
        return 'M';
      case 'struct':
        return 'S';
      case 'typeparameter':
        return 'T';
      default:
        return '?';
    }
  }
}

/// Type of search being performed
enum SearchType {
  files, // Search file names
  text, // Search file contents
  symbols, // Search code symbols
}
