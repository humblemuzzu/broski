import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:broski/models/link/pairing_failure.dart';
import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/services/link/machine_bundle_fetcher.dart';
import 'package:broski/services/link/pairing_input.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

import 'link_fixtures.dart';

({PendingPairing pending, Uint8List publicBundle}) pairOffer(
  LinkIdentity identity, {
  String? relay,
  List<String> lan = const [],
}) {
  final uri = v2PairUri(
    fingerprint: bundleFingerprint(identity.publicBundle),
    secret: patternBytes(32, seed: 11),
    expiresAt: 1900000000,
    name: 'Studio Mac',
    relay: relay,
    lan: lan,
  );
  final pending = parsePairingInput(
    uri,
    DateTime.fromMillisecondsSinceEpoch(0, isUtc: true),
  );
  if (pending == null) {
    throw StateError('the fixture uri is not a v2 offer');
  }
  return (pending: pending, publicBundle: identity.publicBundle);
}

/// A machine answering `/v1/identity` on loopback.
Future<({String host, List<String> requestedPaths})> serveIdentity(
  Uint8List publicBundle, {
  Duration delay = Duration.zero,
}) async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final requestedPaths = <String>[];
  server.listen((request) async {
    requestedPaths.add(request.uri.path);
    if (delay > Duration.zero) {
      await Future<void>.delayed(delay);
    }
    request.response
      ..headers.contentType = ContentType.json
      ..write(jsonEncode({'pub': base64UrlNoPad(publicBundle)}));
    await request.response.close();
  });
  addTearDown(() => server.close(force: true));
  return (host: '127.0.0.1:${server.port}', requestedPaths: requestedPaths);
}

/// An address that refuses connections.
Future<String> closedAddress() async {
  final socket = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
  final address = '127.0.0.1:${socket.port}';
  await socket.close();
  return address;
}

void main() {
  test('fetches the bundle the QR fingerprints', () async {
    final identity = LinkIdentity.generate();
    final served = await serveIdentity(identity.publicBundle);

    final bundle = await MachineBundleFetcher().fetch(
      pairOffer(identity, lan: [served.host]).pending,
    );

    expect(bundle, identity.publicBundle);
    expect(served.requestedPaths, ['/v1/identity']);
  });

  test('refuses a bundle that is not the machine the QR pinned', () async {
    final impostor = await serveIdentity(LinkIdentity.generate().publicBundle);

    await expectLater(
      MachineBundleFetcher().fetch(
        pairOffer(LinkIdentity.generate(), lan: [impostor.host]).pending,
      ),
      throwsA(isA<FingerprintMismatchFailure>()),
    );
  });

  test('fails when no advertised address answers', () async {
    await expectLater(
      MachineBundleFetcher().fetch(
        pairOffer(
          LinkIdentity.generate(),
          lan: [await closedAddress()],
        ).pending,
      ),
      throwsA(isA<IdentityUnreachableFailure>()),
    );
  });

  test('a fast wrong machine never wins over a slow correct one', () async {
    final impostor = await serveIdentity(LinkIdentity.generate().publicBundle);
    final machine = LinkIdentity.generate();
    final correct = await serveIdentity(
      machine.publicBundle,
      delay: const Duration(milliseconds: 250),
    );

    final bundle = await MachineBundleFetcher(
      timeout: const Duration(seconds: 5),
    ).fetch(pairOffer(machine, lan: [impostor.host, correct.host]).pending);

    expect(bundle, machine.publicBundle);
  });

  test('fails when every address answers with another machine', () async {
    final first = await serveIdentity(LinkIdentity.generate().publicBundle);
    final second = await serveIdentity(LinkIdentity.generate().publicBundle);

    await expectLater(
      MachineBundleFetcher().fetch(
        pairOffer(
          LinkIdentity.generate(),
          lan: [first.host, second.host],
        ).pending,
      ),
      throwsA(isA<FingerprintMismatchFailure>()),
    );
  });

  test('asks the relay for the bundle of the machine the QR names', () async {
    final identity = LinkIdentity.generate();
    final relay = await serveIdentity(identity.publicBundle);
    final offer = pairOffer(identity, relay: 'ws://${relay.host}');

    final bundle = await MachineBundleFetcher().fetch(offer.pending);

    expect(bundle, identity.publicBundle);
    expect(relay.requestedPaths, ['/v1/identity/${offer.pending.machineId}']);
  });

  test('fails when the QR advertises no address at all', () async {
    await expectLater(
      MachineBundleFetcher().fetch(pairOffer(LinkIdentity.generate()).pending),
      throwsA(isA<IdentityUnreachableFailure>()),
    );
  });

  test('ignores an address that answers with something else', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      request.response
        ..statusCode = HttpStatus.notFound
        ..write('nope');
      await request.response.close();
    });
    addTearDown(() => server.close(force: true));

    await expectLater(
      MachineBundleFetcher().fetch(
        pairOffer(
          LinkIdentity.generate(),
          lan: ['127.0.0.1:${server.port}'],
        ).pending,
      ),
      throwsA(isA<IdentityUnreachableFailure>()),
    );
  });
}
