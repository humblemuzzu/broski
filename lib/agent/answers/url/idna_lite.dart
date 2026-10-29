/// The part of UTS 46 mapping a typed host name meets: ASCII and full-width
/// letters lowercased, full-width forms folded to ASCII, the ideographic full
/// stops read as dots, ignored code points dropped. Null when the name holds a
/// code point UTS 46 disallows among the common ones, or one it maps to a
/// space, which no host may hold.
String? idnaMapped(String domain) {
  final mapped = <int>[];
  for (final point in domain.runes) {
    if (isIdnaDisallowed(point) || _mapsToSpace(point)) return null;
    if (_isIgnored(point)) continue;
    mapped.add(_lowerAscii(_folded(point)));
  }
  return String.fromCharCodes(mapped);
}

/// Whether [point] may stand in a label decoded from Punycode, as far as
/// these tables tell: UTS 46 refuses a decoded label that its own mapping
/// would change, so no code point here may be disallowed, ignored, folded or
/// lowercased. Cherokee is the one script whose case folding goes to the
/// capitals, which UTS 46 therefore keeps.
bool isIdnaValidInLabel(int point) =>
    !isIdnaDisallowed(point) &&
    !_mapsToSpace(point) &&
    !_isIgnored(point) &&
    _folded(point) == point &&
    (_isCherokeeCapital(point) || !_lowercases(point));

/// The code points no version of UTS 46 has allowed or will: controls,
/// surrogates, private use, U+FFFD and the noncharacters. Unassigned code
/// points are not among them, since a later Unicode assigns some.
bool isIdnaDisallowed(int point) =>
    (point >= 0x80 && point <= 0x9f) ||
    point == 0x2028 ||
    point == 0x2029 ||
    (point >= 0xd800 && point <= 0xf8ff) ||
    point >= 0xf0000 ||
    point == 0xfffd ||
    (point >= 0xfdd0 && point <= 0xfdef) ||
    (point & 0xfffe) == 0xfffe;

/// The spaces UTS 46 maps to U+0020 (or disallows), a forbidden host code
/// point either way.
bool _mapsToSpace(int point) =>
    point == 0xa0 ||
    point == 0x1680 ||
    (point >= 0x2000 && point <= 0x200a) ||
    point == 0x202f ||
    point == 0x205f ||
    point == 0x3000;

bool _isIgnored(int point) =>
    point == 0xad ||
    point == 0x34f ||
    (point >= 0x180b && point <= 0x180d) ||
    point == 0x200b ||
    point == 0x2060 ||
    (point >= 0xfe00 && point <= 0xfe0f) ||
    point == 0xfeff;

int _folded(int point) {
  if (point >= 0xff01 && point <= 0xff5e) return point - 0xfee0;
  if (point == 0x3002 || point == 0xff61) return 0x2e;
  return point;
}

int _lowerAscii(int point) =>
    point >= 0x41 && point <= 0x5a ? point + 0x20 : point;

bool _lowercases(int point) {
  final text = String.fromCharCode(point);
  return text.toLowerCase() != text;
}

bool _isCherokeeCapital(int point) => point >= 0x13a0 && point <= 0x13f5;
