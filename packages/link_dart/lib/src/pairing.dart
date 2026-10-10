import 'dart:convert';
import 'dart:typed_data';

import 'package:broski_link/src/bindings.dart';
import 'package:broski_link/src/buffer.dart';
import 'package:broski_link/src/errors.dart';
import 'package:ffi/ffi.dart';

/// A scanned `broski://pair?v=2&...` QR code.
final class PairingOffer {
  const PairingOffer._({
    required this.fingerprint,
    required this.secret,
    required this.relay,
    required this.lan,
    required this.name,
    required this.expiresAt,
  });

  factory PairingOffer.parse(String uri) {
    final text = utf8.encode(uri);
    final input = copyIn(text);
    final output = newBuffer();
    try {
      checkStatus(blPairingParse(input, text.length, output));
      return _fromJson(utf8.decode(takeBuffer(output)));
    } finally {
      malloc.free(input);
      calloc.free(output);
    }
  }

  static PairingOffer _fromJson(String json) {
    final map = jsonDecode(json) as Map<String, dynamic>;
    return PairingOffer._(
      fingerprint: _base64Url(map['fingerprint'] as String),
      secret: _base64Url(map['secret'] as String),
      relay: map['relay'] as String?,
      lan: (map['lan'] as List<dynamic>).cast<String>(),
      name: map['name'] as String,
      expiresAt: map['expires_at'] as int,
    );
  }

  /// 32 bytes: the machine bundle fingerprint the QR pins.
  final Uint8List fingerprint;

  /// 32 single-use bytes mixed into the Pair handshake.
  final Uint8List secret;
  final String? relay;
  final List<String> lan;
  final String name;
  final int expiresAt;

  /// True at exactly [nowSeconds], matching the Rust side.
  bool isExpired(int nowSeconds) => nowSeconds >= expiresAt;
}

Uint8List _base64Url(String value) =>
    Uint8List.fromList(base64Url.decode(base64Url.normalize(value)));
