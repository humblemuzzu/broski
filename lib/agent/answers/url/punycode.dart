import 'package:broski/agent/answers/url/idna_lite.dart';

const _base = 36;
const _tMin = 1;
const _tMax = 26;
const _skew = 38;
const _damp = 700;
const _maxInt = 0x7fffffff;

/// Whether the part of an `xn--` label after its prefix, lowercased, is one
/// UTS 46 keeps: it decodes as Punycode (RFC 3492) to a label that is not
/// empty and not all ASCII, encodes back to exactly itself, and holds only
/// code points `idna_lite.dart` finds valid in a decoded label.
bool punycodeLabelValid(String encoded) {
  final decoded = _decoded(encoded);
  if (decoded == null || decoded.isEmpty) return false;
  if (decoded.every((point) => point < 0x80)) return false;
  return _encoded(decoded) == encoded && decoded.every(isIdnaValidInLabel);
}

/// RFC 3492 §6.3, with lowercase digits.
String _encoded(List<int> input) {
  final basic = input.where((point) => point < 0x80).toList();
  final text = StringBuffer(String.fromCharCodes(basic));
  if (basic.isNotEmpty) text.write('-');
  var n = 0x80;
  var delta = 0;
  var bias = 72;
  var handled = basic.length;
  while (handled < input.length) {
    final next = input.where((point) => point >= n).reduce(_smaller);
    delta += (next - n) * (handled + 1);
    n = next;
    for (final point in input) {
      if (point < n) delta++;
      if (point != n) continue;
      text.write(_digitsOf(delta, bias));
      bias = _adapt(delta, handled + 1, handled == basic.length);
      delta = 0;
      handled++;
    }
    delta++;
    n++;
  }
  return text.toString();
}

int _smaller(int a, int b) => a < b ? a : b;

/// [value] as a generalized variable-length integer (RFC 3492 §3.3).
String _digitsOf(int value, int bias) {
  final digits = StringBuffer();
  var q = value;
  for (var k = _base; ; k += _base) {
    final t = k <= bias ? _tMin : (k >= bias + _tMax ? _tMax : k - bias);
    if (q < t) break;
    digits.writeCharCode(_digitChar(t + (q - t) % (_base - t)));
    q = (q - t) ~/ (_base - t);
  }
  digits.writeCharCode(_digitChar(q));
  return digits.toString();
}

int _digitChar(int digit) => digit < 26 ? 0x61 + digit : 0x16 + digit;

List<int>? _decoded(String encoded) {
  final delimiter = encoded.lastIndexOf('-');
  final output = delimiter < 0
      ? <int>[]
      : encoded.substring(0, delimiter).codeUnits.toList();
  var next = delimiter < 0 ? 0 : delimiter + 1;
  var n = 0x80;
  var i = 0;
  var bias = 72;
  while (next < encoded.length) {
    final oldI = i;
    var w = 1;
    for (var k = _base; ; k += _base) {
      if (next >= encoded.length) return null;
      final digit = _digit(encoded.codeUnitAt(next++));
      if (digit == null || digit > (_maxInt - i) ~/ w) return null;
      i += digit * w;
      final t = k <= bias ? _tMin : (k >= bias + _tMax ? _tMax : k - bias);
      if (digit < t) break;
      if (w > _maxInt ~/ (_base - t)) return null;
      w *= _base - t;
    }
    final length = output.length + 1;
    bias = _adapt(i - oldI, length, oldI == 0);
    if (i ~/ length > _maxInt - n) return null;
    n += i ~/ length;
    i %= length;
    if (n > 0x10ffff) return null;
    output.insert(i, n);
    i++;
  }
  return output;
}

int? _digit(int unit) {
  if (unit >= 0x30 && unit <= 0x39) return unit - 0x16;
  if (unit >= 0x41 && unit <= 0x5a) return unit - 0x41;
  if (unit >= 0x61 && unit <= 0x7a) return unit - 0x61;
  return null;
}

int _adapt(int delta, int length, bool first) {
  var scaled = first ? delta ~/ _damp : delta ~/ 2;
  scaled += scaled ~/ length;
  var k = 0;
  while (scaled > ((_base - _tMin) * _tMax) ~/ 2) {
    scaled ~/= _base - _tMin;
    k += _base;
  }
  return k + (_base - _tMin + 1) * scaled ~/ (scaled + _skew);
}
