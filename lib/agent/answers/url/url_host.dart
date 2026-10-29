import 'dart:convert';

import 'package:broski/agent/answers/url/idna_lite.dart';
import 'package:broski/agent/answers/url/ipv6_host.dart';
import 'package:broski/agent/answers/url/punycode.dart';

/// Whether the WHATWG host parser accepts [input]: an IPv6 literal, an opaque
/// host for a non-special scheme, or a domain or IPv4 address.
///
/// A domain is checked exactly when it is ASCII and has no `xn--` label. A
/// Unicode domain goes through UTS 46 in a browser, whose full tables this
/// does not carry: `idna_lite.dart` applies the mappings people type and the
/// common disallowed code points, and accepts the rest; a Punycode label is
/// decoded and held to the same tables. So this never refuses a host the
/// bridge accepts, and the bridge's own check refuses a rare one this passes.
bool hostParses(String input, {required bool special}) {
  if (input.startsWith('[')) {
    return input.endsWith(']') &&
        ipv6Parses(input.substring(1, input.length - 1));
  }
  if (!special) return !input.runes.any(_isForbiddenHost);
  final domain = _percentDecoded(input);
  if (domain == null) return false;
  final ascii = _domainToAscii(domain);
  if (ascii == null || ascii.isEmpty) return false;
  if (ascii.runes.any(_isForbiddenDomain)) return false;
  return !_endsInANumber(ascii) || _ipv4Parses(ascii);
}

/// Percent-decoded and read as UTF-8, or null when the bytes are not UTF-8.
String? _percentDecoded(String input) {
  final bytes = utf8.encode(input);
  final decoded = <int>[];
  for (var index = 0; index < bytes.length; index++) {
    final byte = bytes[index];
    if (byte == 0x25 && index + 2 < bytes.length) {
      final high = _hexValue(bytes[index + 1]);
      final low = _hexValue(bytes[index + 2]);
      if (high != null && low != null) {
        decoded.add(high * 16 + low);
        index += 2;
        continue;
      }
    }
    decoded.add(byte);
  }
  try {
    return utf8.decode(decoded);
  } on FormatException {
    return null;
  }
}

String? _domainToAscii(String domain) {
  final mapped = idnaMapped(domain);
  if (mapped == null) return null;
  for (final label in mapped.split('.')) {
    final decodable = label.startsWith('xn--') && _isAscii(label);
    if (decodable && !punycodeLabelValid(label.substring(4))) return null;
  }
  return mapped;
}

/// A label left with code points these tables do not map cannot be decoded
/// here; UTS 46 may map them to ASCII first.
bool _isAscii(String label) => label.codeUnits.every((unit) => unit < 0x80);

bool _isForbiddenHost(int point) => const {
  0x00,
  0x09,
  0x0a,
  0x0d,
  0x20,
  0x23,
  0x2f,
  0x3a,
  0x3c,
  0x3e,
  0x3f,
  0x40,
  0x5b,
  0x5c,
  0x5d,
  0x5e,
  0x7c,
}.contains(point);

bool _isForbiddenDomain(int point) =>
    _isForbiddenHost(point) || point <= 0x1f || point == 0x25 || point == 0x7f;

bool _endsInANumber(String domain) {
  final parts = domain.split('.');
  if (parts.last.isEmpty) {
    if (parts.length == 1) return false;
    parts.removeLast();
  }
  final last = parts.last;
  if (last.isNotEmpty && last.codeUnits.every(_isDigit)) return true;
  return _ipv4Number(last) != null;
}

bool _ipv4Parses(String domain) {
  final parts = domain.split('.');
  if (parts.last.isEmpty && parts.length > 1) parts.removeLast();
  if (parts.length > 4) return false;
  final numbers = <BigInt>[];
  for (final part in parts) {
    final number = _ipv4Number(part);
    if (number == null) return false;
    numbers.add(number);
  }
  final byte = BigInt.from(255);
  for (final number in numbers.sublist(0, numbers.length - 1)) {
    if (number > byte) return false;
  }
  final limit = BigInt.from(256).pow(5 - numbers.length);
  return numbers.last < limit;
}

/// The IPv4 number parser: decimal, `0x` hex or `0` octal; null on failure.
BigInt? _ipv4Number(String input) {
  if (input.isEmpty) return null;
  var digits = input;
  var radix = 10;
  if (digits.length >= 2 &&
      (digits.startsWith('0x') || digits.startsWith('0X'))) {
    digits = digits.substring(2);
    radix = 16;
  } else if (digits.length >= 2 && digits.startsWith('0')) {
    digits = digits.substring(1);
    radix = 8;
  }
  if (digits.isEmpty) return BigInt.zero;
  final valid = digits.codeUnits.every(
    (unit) => switch (radix) {
      16 => _hexValue(unit) != null,
      8 => unit >= 0x30 && unit <= 0x37,
      _ => _isDigit(unit),
    },
  );
  return valid ? BigInt.parse(digits, radix: radix) : null;
}

bool _isDigit(int unit) => unit >= 0x30 && unit <= 0x39;

int? _hexValue(int unit) {
  if (unit >= 0x30 && unit <= 0x39) return unit - 0x30;
  if (unit >= 0x41 && unit <= 0x46) return unit - 0x37;
  if (unit >= 0x61 && unit <= 0x66) return unit - 0x57;
  return null;
}
