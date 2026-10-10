import 'dart:io';
import 'dart:typed_data';

/// One machine the phone can reach: the bundle it pins, the LAN candidates it
/// announced and the relay it is registered with.
final class MachineEndpoint {
  MachineEndpoint({
    required this.machineId,
    required this.serverPublicBundle,
    required this.deviceId,
    this.lan = const <String>[],
    this.relay,
    this.relayToken,
  });

  final String machineId;
  final Uint8List serverPublicBundle;

  /// LAN candidates as `host:port`.
  final List<String> lan;

  /// Relay base address, `wss://<relay>` in production.
  final Uri? relay;
  final String deviceId;
  final String? relayToken;

  /// `ws://<candidate>/v1/link` for one LAN candidate.
  Uri lanLink(String candidate) => Uri.parse('ws://$candidate/v1/link');

  /// The relay's device socket, or null without a relay or a bearer token.
  ///
  /// Plain `ws://` is refused off loopback and private addresses so a tampered
  /// offer cannot downgrade the route to cleartext.
  Uri? relayDevice() {
    final base = relay;
    if (base == null || relayToken == null) {
      return null;
    }
    final scheme = base.scheme;
    if (scheme != 'ws' && scheme != 'wss') {
      throw ArgumentError.value(
        base,
        'relay',
        'the relay scheme must be ws or wss',
      );
    }
    if (scheme == 'ws' && !isLoopbackOrPrivateHost(base.host)) {
      throw ArgumentError.value(
        base,
        'relay',
        'plaintext ws:// is only allowed on loopback or private hosts',
      );
    }
    return Uri(
      scheme: scheme,
      host: base.host,
      port: base.hasPort ? base.port : null,
      path: '/v1/device',
    );
  }

  /// Headers of the relay's device socket.
  Map<String, String> relayHeaders() {
    final token = relayToken;
    if (token == null) {
      throw StateError('a relay token is required for the relay route');
    }
    return <String, String>{
      'x-broski-machine': machineId,
      'x-broski-device': deviceId,
      'authorization': 'Bearer $token',
    };
  }

  /// Whether [other] names the same machine with the same pinned bundle, so a
  /// session with it can be kept.
  bool isSameMachine(MachineEndpoint other) =>
      machineId == other.machineId &&
      _sameBytes(serverPublicBundle, other.serverPublicBundle);

  @override
  String toString() => 'MachineEndpoint($machineId, lan=$lan, relay=$relay)';
}

bool _sameBytes(Uint8List left, Uint8List right) {
  if (identical(left, right)) {
    return true;
  }
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

/// Loopback, RFC 1918, CGNAT (Tailscale) and IPv6 unique-local and link-local
/// hosts.
bool isLoopbackOrPrivateHost(String host) {
  if (host == 'localhost' || host.endsWith('.local')) {
    return true;
  }
  final address = InternetAddress.tryParse(host);
  if (address == null) {
    return false;
  }
  final bytes = address.rawAddress;
  if (bytes.length == 4) {
    return bytes[0] == 127 ||
        bytes[0] == 10 ||
        (bytes[0] == 192 && bytes[1] == 168) ||
        (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
        (bytes[0] == 100 && bytes[1] >= 64 && bytes[1] <= 127);
  }
  return (bytes[0] & 0xfe) == 0xfc ||
      (bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80) ||
      _isIpv6Loopback(bytes);
}

bool _isIpv6Loopback(Uint8List bytes) {
  for (var index = 0; index < bytes.length - 1; index++) {
    if (bytes[index] != 0) {
      return false;
    }
  }
  return bytes[bytes.length - 1] == 1;
}
