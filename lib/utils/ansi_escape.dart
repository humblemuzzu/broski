/// Terminal escape sequences that reach the app as text.
///
/// A provider writes coloured or cursor-moving output — `ESC [ 38;2;215;153;33 m Thinking: ESC [ 39 m`
/// — and the transcript keeps it verbatim, which is right for a file but not for a card on a phone.
/// The sequences carry no meaning the app can render, so they are dropped when text is shown.
library;

const int _escape = 0x1B;
const int _csiIntroducer = 0x5B;
const int _oscIntroducer = 0x5D;
const int _bell = 0x07;
const int _backslash = 0x5C;

/// The last byte of a CSI sequence: `@` to `~`.
const int _csiFinalMin = 0x40;
const int _csiFinalMax = 0x7E;

/// The parameter and intermediate bytes of a CSI sequence.
const int _csiBodyMin = 0x20;
const int _csiBodyMax = 0x3F;

/// `text` with every ANSI/VT escape sequence removed. Text without an `ESC` is returned as is.
String stripAnsi(String text) {
  var start = text.indexOf('\u001b');
  if (start == -1) return text;

  final out = StringBuffer();
  var kept = 0;
  while (start != -1) {
    out.write(text.substring(kept, start));
    kept = _sequenceEnd(text, start + 1);
    start = text.indexOf('\u001b', kept);
  }
  out.write(text.substring(kept));
  return out.toString();
}

/// The index just past the escape sequence whose `ESC` sits at `start - 1`.
int _sequenceEnd(String text, int start) {
  if (start >= text.length) return start;
  switch (text.codeUnitAt(start)) {
    case _csiIntroducer:
      return _csiEnd(text, start + 1);
    case _oscIntroducer:
      return _oscEnd(text, start + 1);
    default:
      return start + 1;
  }
}

int _csiEnd(String text, int start) {
  var index = start;
  while (index < text.length) {
    final code = text.codeUnitAt(index);
    if (code >= _csiFinalMin && code <= _csiFinalMax) return index + 1;
    if (code < _csiBodyMin || code > _csiBodyMax) return index;
    index++;
  }
  return index;
}

int _oscEnd(String text, int start) {
  var index = start;
  while (index < text.length) {
    final code = text.codeUnitAt(index);
    if (code == _bell) return index + 1;
    if (code == _escape &&
        index + 1 < text.length &&
        text.codeUnitAt(index + 1) == _backslash) {
      return index + 2;
    }
    index++;
  }
  return index;
}
