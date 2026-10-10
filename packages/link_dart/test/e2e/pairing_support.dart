import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:broski_link/broski_link.dart' show sha256;

/// The one-time relay device id a pairing connection uses, mirroring
/// `daemon/src/pairing.rs`.
String pairingDeviceId(Uint8List secret) =>
    _hex(_digest('broski-pair-id', secret).sublist(0, 16));

/// The one-time relay token a pairing connection uses.
String pairingToken(Uint8List secret) =>
    base64Url.encode(_digest('broski-pair-token', secret)).replaceAll('=', '');

/// The machine id an offer fingerprints: hex of its first 16 fingerprint bytes.
String machineIdOf(Uint8List fingerprint) => _hex(fingerprint.sublist(0, 16));

/// Fetches the bundle [url] serves and refuses one the offer did not pin.
Future<Uint8List> fetchBundle(String url, Uint8List fingerprint) async {
  final client = HttpClient();
  try {
    final request = await client.getUrl(Uri.parse(url));
    final response = await request.close();
    final body = await response.transform(utf8.decoder).join();
    if (response.statusCode != HttpStatus.ok) {
      throw StateError('$url answered ${response.statusCode}: $body');
    }
    final decoded = jsonDecode(body);
    if (decoded is! Map) {
      throw StateError('$url answered $body');
    }
    final pub = decoded['pub'];
    if (pub is! String) {
      throw StateError('$url answered $body');
    }
    final bundle = Uint8List.fromList(
      base64Url.decode(base64Url.normalize(pub)),
    );
    if (!_equal(sha256(bundle), fingerprint)) {
      throw StateError('$url serves a bundle the offer does not fingerprint');
    }
    return bundle;
  } finally {
    client.close(force: true);
  }
}

Future<bool> _get(String url) async {
  final client = HttpClient();
  try {
    final request = await client.getUrl(Uri.parse(url));
    final response = await request.close();
    await response.drain<void>();
    return response.statusCode == HttpStatus.ok;
  } finally {
    client.close(force: true);
  }
}

/// Waits until the relay has published [machine]'s identity bundle.
Future<void> awaitRelayIdentity(
  Uri relay,
  String machine,
  Duration budget,
) async {
  final url = 'http://${relay.host}:${relay.port}/v1/identity/$machine';
  final deadline = DateTime.now().add(budget);
  while (true) {
    if (await _get(url)) {
      return;
    }
    if (DateTime.now().isAfter(deadline)) {
      throw StateError('the relay never published $url');
    }
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
}

/// Waits until the relay authorises [device] for [machine].
Future<void> awaitRelayDevice(
  Uri relay,
  String machine,
  String device,
  String token,
  Duration budget,
) async {
  final url = 'http://${relay.host}:${relay.port}/v1/status/$machine';
  final client = HttpClient();
  try {
    final deadline = DateTime.now().add(budget);
    while (true) {
      final request = await client.getUrl(Uri.parse(url));
      request.headers
        ..set('x-broski-machine', machine)
        ..set('x-broski-device', device)
        ..set('authorization', 'Bearer $token');
      final response = await request.close();
      await response.drain<void>();
      if (response.statusCode == HttpStatus.ok) {
        return;
      }
      if (DateTime.now().isAfter(deadline)) {
        throw StateError(
          'the relay never authorised $device for $machine '
          '(last status ${response.statusCode})',
        );
      }
      await Future<void>.delayed(const Duration(milliseconds: 50));
    }
  } finally {
    client.close(force: true);
  }
}

List<int> _digest(String context, Uint8List secret) =>
    sha256(Uint8List.fromList(<int>[...ascii.encode(context), ...secret]));

String _hex(List<int> bytes) => <String>[
  for (final byte in bytes) byte.toRadixString(16).padLeft(2, '0'),
].join();

bool _equal(List<int> left, List<int> right) {
  if (left.length != right.length) {
    return false;
  }
  for (var index = 0; index < left.length; index++) {
    if (left[index] != right[index]) {
      return false;
    }
  }
  return true;
}
