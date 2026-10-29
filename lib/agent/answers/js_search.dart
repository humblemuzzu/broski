/// Whether [pattern] matches somewhere in [text] as ECMAScript searches: with
/// `unicode`, a match starts only at the start of a code point. Dart 3.10's
/// engine also tries a start between the halves of a surrogate pair, where
/// `\B` and a negative lookbehind can match; when its first match starts
/// there, the code points after it are tried one by one.
bool searchesLikeEcmaScript(
  RegExp pattern,
  String text, {
  required bool unicode,
}) {
  final first = pattern.firstMatch(text);
  if (first == null) return false;
  if (!unicode || !_insidePair(text, first.start)) return true;
  for (
    var at = first.start + 1;
    at <= text.length;
    at += _isPairAt(text, at) ? 2 : 1
  ) {
    if (pattern.matchAsPrefix(text, at) != null) return true;
  }
  return false;
}

bool _insidePair(String text, int index) =>
    index > 0 &&
    index < text.length &&
    _isHigh(text.codeUnitAt(index - 1)) &&
    _isLow(text.codeUnitAt(index));

bool _isPairAt(String text, int index) =>
    index + 1 < text.length &&
    _isHigh(text.codeUnitAt(index)) &&
    _isLow(text.codeUnitAt(index + 1));

bool _isHigh(int unit) => unit >= 0xd800 && unit <= 0xdbff;

bool _isLow(int unit) => unit >= 0xdc00 && unit <= 0xdfff;
