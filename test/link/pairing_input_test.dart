import 'dart:convert';

import 'package:broski/services/link/pairing_input.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_fixtures.dart';

final _now = DateTime.fromMillisecondsSinceEpoch(
  1800000000 * 1000,
  isUtc: true,
);

String validUri({
  int expiresAt = 1800000060,
  String name = 'Studio Mac',
  String? relay = 'wss://relay.example/x',
  List<String> lan = const ['10.0.0.2:8765'],
}) => v2PairUri(
  fingerprint: patternBytes(32),
  secret: patternBytes(32, seed: 11),
  expiresAt: expiresAt,
  name: name,
  relay: relay,
  lan: lan,
);

void main() {
  test('a legacy JSON QR is not a Link offer', () {
    expect(
      parsePairingInput('{"p":8765,"l":"192.168.1.5","a":"tok"}', _now),
      isNull,
    );
    expect(parsePairingInput('https://example.com/pair?v=2', _now), isNull);
    expect(parsePairingInput('', _now), isNull);
    expect(parsePairingInput('broski://pairing?v=2', _now), isNull);
  });

  test('a v2 URI yields the pending pairing', () {
    final fingerprint = patternBytes(32);
    final secret = patternBytes(32, seed: 11);
    final uri = v2PairUri(
      fingerprint: fingerprint,
      secret: secret,
      expiresAt: 1800000060,
      name: 'Studio Mac / café',
      relay: 'wss://relay.example/x',
      lan: ['10.0.0.2:8765', '192.168.1.9:8765'],
    );

    final pending = parsePairingInput(uri, _now)!;

    expect(pending.fingerprint, fingerprint);
    expect(pending.secret, secret);
    expect(pending.name, 'Studio Mac / café');
    expect(pending.relay, Uri.parse('wss://relay.example/x'));
    expect(pending.lan, ['10.0.0.2:8765', '192.168.1.9:8765']);
    expect(
      pending.expiresAt,
      DateTime.fromMillisecondsSinceEpoch(1800000060 * 1000, isUtc: true),
    );
  });

  test('a v2 URI without a relay or lan list parses', () {
    final pending = parsePairingInput(
      validUri(relay: null, lan: const []),
      _now,
    )!;

    expect(pending.relay, isNull);
    expect(pending.lan, isEmpty);
  });

  test('a pending pairing does not print its secret', () {
    final pending = parsePairingInput(validUri(), _now)!;

    expect(pending.toString(), contains('Studio Mac'));
    expect(
      pending.toString(),
      isNot(contains(base64Url.encode(pending.secret))),
    );
  });

  test('the machine id of a real identity matches the one it signs with', () {
    final identity = LinkIdentity.generate();
    final uri = v2PairUri(
      fingerprint: bundleFingerprint(identity.publicBundle),
      secret: patternBytes(32),
      expiresAt: 1800000060,
      name: 'Studio Mac',
    );

    final pending = parsePairingInput(uri, _now)!;

    expect(pending.machineId, identity.id);
  });

  test('an expired v2 URI throws at and after its expiry second', () {
    expect(
      () => parsePairingInput(validUri(expiresAt: 1800000000), _now),
      throwsA(
        isA<ExpiredPairingException>().having(
          (error) => error.expiresAt,
          'expiresAt',
          DateTime.fromMillisecondsSinceEpoch(1800000000 * 1000, isUtc: true),
        ),
      ),
    );
    expect(
      () => parsePairingInput(validUri(expiresAt: 1799999999), _now),
      throwsA(isA<ExpiredPairingException>()),
    );
    expect(parsePairingInput(validUri(expiresAt: 1800000001), _now), isNotNull);
  });

  test('a malformed v2 URI throws', () {
    for (final text in <String>[
      'broski://pair',
      'broski://pair?v=2',
      'broski://pair?v=3&h=AAAA&s=AAAA&e=1&n=x',
      'broski://pair?v=2&h=AAAA&s=AAAA&e=1&n=x',
      'broski://pair?v=2&v=2&h=AAAA&s=AAAA&e=1&n=x',
      'broski://pair?v=2&h=AAAA&s=AAAA&e=1&n=x&x=1',
    ]) {
      expect(
        () => parsePairingInput(text, _now),
        throwsA(isA<MalformedPairingException>()),
        reason: text,
      );
    }
  });

  test('a v2 URI with a bad expiry or oversized name throws', () {
    expect(
      () =>
          parsePairingInput('broski://pair?v=2&h=AAAA&s=AAAA&e=soon&n=x', _now),
      throwsA(isA<MalformedPairingException>()),
    );
    expect(
      () => parsePairingInput(validUri(name: 'x' * 65), _now),
      throwsA(isA<MalformedPairingException>()),
    );
  });
}
