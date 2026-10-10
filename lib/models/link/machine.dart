import 'dart:convert';
import 'dart:typed_data';

/// A machine this phone is paired with.
class Machine {
  const Machine({
    required this.id,
    required this.name,
    required this.publicBundle,
    required this.fingerprint,
    required this.lan,
    required this.pairedAt,
    this.os,
    this.relay,
    this.relayToken,
    this.lastConnectedAt,
  });

  factory Machine.fromJson(Map<String, dynamic> json) {
    final relay = json['relay'] as String?;
    final lastConnectedAt = json['lastConnectedAt'] as String?;
    return Machine(
      id: json['id'] as String,
      name: json['name'] as String,
      os: json['os'] as String?,
      publicBundle: _bytesFrom(json['publicBundle'] as String),
      fingerprint: _bytesFrom(json['fingerprint'] as String),
      relay: relay == null ? null : Uri.parse(relay),
      lan: (json['lan'] as List<dynamic>).cast<String>(),
      relayToken: json['relayToken'] as String?,
      pairedAt: DateTime.parse(json['pairedAt'] as String),
      lastConnectedAt: lastConnectedAt == null
          ? null
          : DateTime.parse(lastConnectedAt),
    );
  }

  /// The machine id: lowercase hex of the first 16 fingerprint bytes.
  final String id;
  final String name;
  final String? os;
  final Uint8List publicBundle;
  final Uint8List fingerprint;
  final Uri? relay;
  final List<String> lan;
  final String? relayToken;
  final DateTime pairedAt;
  final DateTime? lastConnectedAt;

  Map<String, dynamic> toJson() {
    final relay = this.relay;
    final relayToken = this.relayToken;
    final lastConnectedAt = this.lastConnectedAt;
    final os = this.os;
    return {
      'id': id,
      'name': name,
      if (os != null) 'os': os,
      'publicBundle': base64Url.encode(publicBundle),
      'fingerprint': base64Url.encode(fingerprint),
      if (relay != null) 'relay': relay.toString(),
      'lan': lan,
      if (relayToken != null) 'relayToken': relayToken,
      'pairedAt': pairedAt.toIso8601String(),
      if (lastConnectedAt != null)
        'lastConnectedAt': lastConnectedAt.toIso8601String(),
    };
  }

  Machine copyWith({
    Uri? relay,
    bool clearRelay = false,
    List<String>? lan,
    DateTime? lastConnectedAt,
  }) {
    return Machine(
      id: id,
      name: name,
      os: os,
      publicBundle: publicBundle,
      fingerprint: fingerprint,
      relay: clearRelay ? null : relay ?? this.relay,
      lan: lan ?? this.lan,
      relayToken: relayToken,
      pairedAt: pairedAt,
      lastConnectedAt: lastConnectedAt ?? this.lastConnectedAt,
    );
  }

  @override
  String toString() => 'Machine($id, $name)';
}

Uint8List _bytesFrom(String value) =>
    Uint8List.fromList(base64Url.decode(value));
