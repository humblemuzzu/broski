const _colon = 0x3a;
const _dot = 0x2e;

/// Whether the WHATWG IPv6 parser accepts [input], the text between the
/// brackets: eight 16-bit pieces, one `::` at most, and an optional dotted IPv4
/// tail in the last two.
bool ipv6Parses(String input) {
  final points = input.codeUnits;
  var pieceIndex = 0;
  int? compress;
  var pointer = 0;
  int? at(int index) => index < points.length ? points[index] : null;
  if (at(0) == _colon) {
    if (at(1) != _colon) return false;
    pointer = 2;
    pieceIndex = 1;
    compress = 1;
  }
  while (at(pointer) != null) {
    if (pieceIndex == 8) return false;
    if (at(pointer) == _colon) {
      if (compress != null) return false;
      pointer++;
      pieceIndex++;
      compress = pieceIndex;
      continue;
    }
    var length = 0;
    while (length < 4 && _isHex(at(pointer))) {
      pointer++;
      length++;
    }
    if (at(pointer) == _dot) {
      if (length == 0 || pieceIndex > 6) return false;
      if (!_ipv4TailParses(points.sublist(pointer - length))) return false;
      pieceIndex += 2;
      break;
    }
    if (at(pointer) == _colon) {
      pointer++;
      if (at(pointer) == null) return false;
    } else if (at(pointer) != null) {
      return false;
    }
    pieceIndex++;
  }
  return compress != null || pieceIndex == 8;
}

/// Exactly four decimal numbers of at most 255, without leading zeros.
bool _ipv4TailParses(List<int> points) {
  var numbersSeen = 0;
  var pointer = 0;
  while (pointer < points.length) {
    if (numbersSeen > 0) {
      if (points[pointer] != _dot || numbersSeen >= 4) return false;
      pointer++;
    }
    if (pointer >= points.length || !_isDigit(points[pointer])) return false;
    int? piece;
    while (pointer < points.length && _isDigit(points[pointer])) {
      final digit = points[pointer] - 0x30;
      if (piece == 0) return false;
      piece = (piece ?? 0) * 10 + digit;
      if (piece > 255) return false;
      pointer++;
    }
    numbersSeen++;
  }
  return numbersSeen == 4;
}

bool _isHex(int? unit) =>
    unit != null &&
    ((unit >= 0x30 && unit <= 0x39) ||
        (unit >= 0x41 && unit <= 0x46) ||
        (unit >= 0x61 && unit <= 0x66));

bool _isDigit(int unit) => unit >= 0x30 && unit <= 0x39;
