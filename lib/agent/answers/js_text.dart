/// The few places where the contract's answer check leans on JavaScript's own
/// string semantics, reproduced so the app reaches the bridge's verdict.
library;

/// What JavaScript's `String.prototype.trim` removes: WhiteSpace (tab, VT, FF,
/// space, NBSP, BOM and the Zs category) and LineTerminator. Dart's own `trim`
/// also removes U+0085, which JavaScript keeps.
bool _isJsWhitespace(int unit) =>
    unit == 0x09 ||
    unit == 0x0a ||
    unit == 0x0b ||
    unit == 0x0c ||
    unit == 0x0d ||
    unit == 0x20 ||
    unit == 0xa0 ||
    unit == 0x1680 ||
    (unit >= 0x2000 && unit <= 0x200a) ||
    unit == 0x2028 ||
    unit == 0x2029 ||
    unit == 0x202f ||
    unit == 0x205f ||
    unit == 0x3000 ||
    unit == 0xfeff;

/// Whether `text.trim() === ""` holds in JavaScript.
bool isJsBlank(String text) => text.codeUnits.every(_isJsWhitespace);

/// `[...text].length` in JavaScript: code points, a lone surrogate counting as one.
int codePointLength(String text) => text.runes.length;

/// `Number.isInteger(value)`.
bool isJsInteger(double value) =>
    value.isFinite && value == value.truncateToDouble();

/// [keys] in the order JavaScript's `Object.keys` lists an object's own
/// properties: array indices ascending, then the rest in insertion order.
List<String> jsPropertyOrder(Iterable<String> keys) {
  final indices = keys.where(_isArrayIndex).toList()
    ..sort((a, b) => int.parse(a).compareTo(int.parse(b)));
  return [...indices, ...keys.where((key) => !_isArrayIndex(key))];
}

/// A canonical decimal below 2^32 - 1, as ECMAScript defines an array index.
bool _isArrayIndex(String key) {
  if (key.isEmpty || key.length > 10) return false;
  if (key.length > 1 && key.startsWith('0')) return false;
  if (!key.codeUnits.every((unit) => unit >= 0x30 && unit <= 0x39)) {
    return false;
  }
  return int.parse(key) < 0xffffffff;
}
