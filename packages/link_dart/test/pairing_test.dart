import 'dart:convert';
import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

String b64(Uint8List bytes) => base64Url.encode(bytes).replaceAll('=', '');

Uint8List pattern(int seed) =>
    Uint8List.fromList(List.generate(32, (index) => (index + seed) & 0xff));

void main() {
  test('parses a full offer', () {
    final fingerprint = pattern(0);
    final secret = pattern(11);
    final uri =
        'broski://pair?v=2&h=${b64(fingerprint)}&s=${b64(secret)}'
        '&e=1800000000&n=Broski%20Mac'
        '&r=${Uri.encodeComponent('wss://relay.example/x')}&l=10.0.0.2:8765';
    final offer = PairingOffer.parse(uri);
    expect(offer.fingerprint, fingerprint);
    expect(offer.secret, secret);
    expect(offer.name, 'Broski Mac');
    expect(offer.relay, 'wss://relay.example/x');
    expect(offer.lan, ['10.0.0.2:8765']);
    expect(offer.expiresAt, 1800000000);
    expect(offer.isExpired(1799999999), isFalse);
    expect(offer.isExpired(1800000000), isTrue);
  });

  test('parses an offer without a relay or lan list', () {
    final uri =
        'broski://pair?v=2&h=${b64(pattern(0))}&s=${b64(pattern(11))}'
        '&e=42&n=phone';
    final offer = PairingOffer.parse(uri);
    expect(offer.relay, isNull);
    expect(offer.lan, isEmpty);
    expect(offer.name, 'phone');
  });

  test('maps a malformed uri to a typed error', () {
    expect(
      () => PairingOffer.parse('not a pair uri'),
      throwsA(isA<LinkProtocolException>()),
    );
    expect(
      () => PairingOffer.parse('broski://pair?v=2'),
      throwsA(isA<LinkProtocolException>()),
    );
    expect(
      () => PairingOffer.parse('broski://pair?v=3&h=x&s=y&e=1&n=z'),
      throwsA(isA<LinkProtocolException>()),
    );
  });
}
