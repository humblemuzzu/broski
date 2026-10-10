import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:broski/models/link/pairing_failure.dart';
import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski_link/broski_link.dart' show publicBundleLength;
import 'package:crypto/crypto.dart';

/// Fetches the machine bundle a QR pins, from any address the QR advertises.
///
/// A candidate that answers with a bundle whose SHA-256 is not the QR
/// fingerprint is disqualified, never returned: the QR is the only thing
/// telling this phone which machine it is talking to.
class MachineBundleFetcher {
  MachineBundleFetcher({this.timeout = const Duration(milliseconds: 1500)});

  /// How long any one address gets to answer.
  final Duration timeout;

  Future<Uint8List> fetch(PendingPairing pending) async {
    final candidates = _candidates(pending);
    if (candidates.isEmpty) {
      throw const IdentityUnreachableFailure(
        'This QR code has no address to reach the machine at.',
      );
    }

    final winner = Completer<Uint8List>();
    var remaining = candidates.length;
    var mismatched = false;

    void settle() {
      remaining -= 1;
      if (remaining > 0 || winner.isCompleted) return;
      winner.completeError(
        mismatched
            ? const FingerprintMismatchFailure(
                'That machine is not the one this QR code pairs with.',
              )
            : const IdentityUnreachableFailure(
                'The machine did not answer. Check that it is running and '
                'that this phone can reach it.',
              ),
      );
    }

    for (final uri in candidates) {
      unawaited(
        _fetch(uri).then((bundle) {
          if (winner.isCompleted) return;
          if (bundle == null) {
            settle();
            return;
          }
          if (!_matchesFingerprint(bundle, pending.fingerprint)) {
            mismatched = true;
            settle();
            return;
          }
          winner.complete(bundle);
        }),
      );
    }
    return winner.future;
  }

  /// The bundle [uri] served, or null when it did not serve a usable one in
  /// time.
  Future<Uint8List?> _fetch(Uri uri) async {
    final client = HttpClient()..connectionTimeout = timeout;
    try {
      return await _bundle(uri, client).timeout(timeout);
    } on Object {
      return null;
    } finally {
      client.close(force: true);
    }
  }

  Future<Uint8List?> _bundle(Uri uri, HttpClient client) async {
    final request = await client.getUrl(uri);
    final response = await request.close();
    if (response.statusCode != HttpStatus.ok) return null;
    final decoded = jsonDecode(await response.transform(utf8.decoder).join());
    if (decoded is! Map<String, dynamic>) return null;
    final pub = decoded['pub'];
    if (pub is! String) return null;
    final bundle = Uint8List.fromList(
      base64Url.decode(base64Url.normalize(pub)),
    );
    return bundle.length == publicBundleLength ? bundle : null;
  }

  List<Uri> _candidates(PendingPairing pending) {
    final uris = <Uri>[
      for (final host in pending.lan) Uri.parse('http://$host/v1/identity'),
    ];
    final relay = pending.relay;
    if (relay != null) {
      uris.add(
        Uri(
          scheme: relay.scheme == 'wss' ? 'https' : 'http',
          host: relay.host,
          port: relay.hasPort ? relay.port : null,
          path: '/v1/identity/${pending.machineId}',
        ),
      );
    }
    return uris;
  }

  bool _matchesFingerprint(Uint8List bundle, Uint8List fingerprint) {
    final digest = sha256.convert(bundle).bytes;
    if (digest.length != fingerprint.length) return false;
    var difference = 0;
    for (var index = 0; index < digest.length; index++) {
      difference |= digest[index] ^ fingerprint[index];
    }
    return difference == 0;
  }
}
