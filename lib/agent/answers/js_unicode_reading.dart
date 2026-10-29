/// A pattern's `u` reading as JavaScriptCore (Bun) has it, in the form Dart's
/// engine judges the same way (app-core README §8):
///
/// - JavaScriptCore reads `\X` for a non-ASCII `X` in the Basic Multilingual
///   Plane as the character itself, in a class or out of one; Dart refuses it.
///   The backslash goes. An astral `X` stays: JavaScriptCore reads it as no
///   character, and Dart's refusal to compile it leaves that reading unjudged.
/// - Dart 3.10 misses U+0000 against a negated class when the text holds a code
///   unit above U+00FF; with U+0000 in the text each `[^…]` becomes the
///   lookahead `(?:(?![…])[\s\S])` that means the same.
/// - A `\p{…}` escape is judged by the engine's own Unicode database, which
///   differs from the bridge's on every character added since: [usesProperties]
///   tells the caller to trust it only for ASCII text.
({String pattern, bool usesProperties}) unicodeReading(
  String pattern, {
  required bool textHasNul,
}) {
  final reading = _Reading(pattern, textHasNul)..run();
  return (
    pattern: reading.out.toString(),
    usesProperties: reading.usesProperties,
  );
}

final class _Reading {
  _Reading(this._s, this._textHasNul);

  final String _s;
  final bool _textHasNul;
  final out = StringBuffer();
  var usesProperties = false;
  var _i = 0;

  void run() {
    while (_i < _s.length) {
      switch (_s[_i]) {
        case r'\':
          _escape(out);
        case '[':
          _characterClass();
        default:
          out.writeCharCode(_s.codeUnitAt(_i++));
      }
    }
  }

  /// The escape at [_i] (a backslash), into [into].
  void _escape(StringBuffer into) {
    if (_i + 1 >= _s.length) {
      into.write(_s[_i++]);
      return;
    }
    final next = _s.codeUnitAt(_i + 1);
    if (next > 0x7f && (next < 0xd800 || next > 0xdfff)) {
      into.writeCharCode(next);
      _i += 2;
      return;
    }
    if ((next == 0x70 || next == 0x50) && _s.startsWith('{', _i + 2)) {
      usesProperties = true;
    }
    into.write(_s.substring(_i, _i + 2));
    _i += 2;
  }

  void _characterClass() {
    final negated = _s.startsWith('^', _i + 1);
    _i += negated ? 2 : 1;
    final inner = StringBuffer();
    while (_i < _s.length && _s[_i] != ']') {
      if (_s[_i] == r'\') {
        _escape(inner);
      } else {
        inner.writeCharCode(_s.codeUnitAt(_i++));
      }
    }
    final closed = _i < _s.length;
    if (closed) _i++;
    final lookahead = negated && closed && _textHasNul;
    if (lookahead && inner.isEmpty) {
      out.write(r'[\s\S]');
    } else if (lookahead) {
      out.write('(?:(?![$inner])[\\s\\S])');
    } else {
      out.write('[${negated ? '^' : ''}$inner${closed ? ']' : ''}');
    }
  }
}
