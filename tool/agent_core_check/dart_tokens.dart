/// Just enough of Dart's lexical grammar to tell code from comments and
/// strings, so a rule never fires on a word in a comment and never misses a
/// string literal. Nested block comments, raw and triple-quoted strings and
/// `${…}` interpolations (which may hold strings of their own) are handled.
library;

sealed class DartToken {
  const DartToken(this.line);

  final int line;
}

final class WordToken extends DartToken {
  const WordToken(this.word, super.line);

  final String word;
}

/// A string literal, with escapes left as written. [pieces] are its literal
/// runs: an interpolation of a single string literal folds into the run around
/// it, any other interpolation ends one. [value] is the whole text when
/// nothing ends a run.
final class StringToken extends DartToken {
  const StringToken(this.pieces, super.line);

  final List<String> pieces;

  String? get value => pieces.length == 1 ? pieces.single : null;
}

final class PunctToken extends DartToken {
  const PunctToken(this.char, super.line);

  final String char;
}

List<DartToken> dartTokens(String source) => _Lexer(source).run();

final class _Lexer {
  _Lexer(this._s);

  final String _s;
  var _i = 0;
  var _line = 1;
  final List<DartToken> _out = [];

  List<DartToken> run() {
    while (_i < _s.length) {
      _next();
    }
    return _out;
  }

  String get _c => _s[_i];
  bool _at(String text) => _s.startsWith(text, _i);

  void _advance([int count = 1]) {
    for (var n = 0; n < count && _i < _s.length; n++) {
      if (_s[_i] == '\n') _line++;
      _i++;
    }
  }

  void _next() {
    if (_at('//')) {
      while (_i < _s.length && _c != '\n') {
        _advance();
      }
    } else if (_at('/*')) {
      _blockComment();
    } else if (_isStringStart()) {
      _string(interpolating: true);
    } else if (_isWordChar(_c)) {
      final start = _i;
      final line = _line;
      while (_i < _s.length && _isWordChar(_c)) {
        _advance();
      }
      _out.add(WordToken(_s.substring(start, _i), line));
    } else {
      if (_c.trim().isNotEmpty) _out.add(PunctToken(_c, _line));
      _advance();
    }
  }

  void _blockComment() {
    var depth = 0;
    do {
      if (_at('/*')) {
        depth++;
        _advance(2);
      } else if (_at('*/')) {
        depth--;
        _advance(2);
      } else {
        _advance();
      }
    } while (depth > 0 && _i < _s.length);
  }

  bool _isStringStart() =>
      _c == '"' ||
      _c == "'" ||
      ((_c == 'r' || _c == 'R') &&
          _i + 1 < _s.length &&
          (_s[_i + 1] == '"' || _s[_i + 1] == "'") &&
          (_i == 0 || !_isWordChar(_s[_i - 1])));

  void _string({required bool interpolating}) {
    final line = _line;
    final raw = _c == 'r' || _c == 'R';
    if (raw) _advance();
    final quote = _c;
    final triple = _at(quote * 3);
    final close = triple ? quote * 3 : quote;
    _advance(close.length);
    final pieces = <String>[];
    var text = StringBuffer();
    void endPiece() {
      pieces.add(text.toString());
      text = StringBuffer();
    }

    while (_i < _s.length && !_at(close)) {
      if (!raw && _c == r'\') {
        text.write(_s.substring(_i, _i + 2));
        _advance(2);
      } else if (!raw && _at(r'${')) {
        _advance(2);
        final folded = _interpolation();
        if (folded == null) {
          endPiece();
        } else {
          text.write(folded);
        }
      } else if (!raw &&
          _c == r'$' &&
          _i + 1 < _s.length &&
          _isWordChar(_s[_i + 1])) {
        endPiece();
        _advance();
      } else {
        text.write(_c);
        _advance();
      }
    }
    _advance(close.length);
    endPiece();
    _out.add(StringToken(pieces, line));
  }

  /// The code inside `${…}`, whose tokens count like any other code. When
  /// it is one string literal, its text, which the string around it folds in.
  String? _interpolation() {
    final first = _out.length;
    var depth = 1;
    while (_i < _s.length && depth > 0) {
      if (_c == '{') depth++;
      if (_c == '}') {
        depth--;
        if (depth == 0) break;
      }
      _next();
    }
    _advance();
    return switch (_out.sublist(first)) {
      [StringToken(:final value)] => value,
      _ => null,
    };
  }
}

bool _isWordChar(String char) {
  final unit = char.codeUnitAt(0);
  return (unit >= 0x30 && unit <= 0x39) ||
      (unit >= 0x41 && unit <= 0x5a) ||
      (unit >= 0x61 && unit <= 0x7a) ||
      unit == 0x5f ||
      unit == 0x24;
}
