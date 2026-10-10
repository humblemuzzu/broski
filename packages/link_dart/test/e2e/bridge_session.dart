import 'dart:async';
import 'dart:convert';

import 'link_phone.dart';

/// Sends real bridge messages over the link and matches each response to the
/// request that caused it, the way the app does: by the `requestId` (or `id`)
/// the request carries. Anything that arrives twice, or names no request, is
/// counted rather than thrown, so a soak can report it at the end.
final class BridgeSession {
  BridgeSession(this._phone) {
    _subscription = _phone.connection.bridgeMessages.listen(_onText);
  }

  final LinkPhone _phone;
  final String _prefix = 'e2e${DateTime.now().microsecondsSinceEpoch}-';
  final Map<String, Completer<Map<String, Object?>>> _waiting =
      <String, Completer<Map<String, Object?>>>{};
  final Map<String, String> _echoes = <String, String>{};
  final Set<String> _answered = <String>{};
  int _sequence = 0;

  late final StreamSubscription<String> _subscription;

  /// Requests sent.
  int sent = 0;

  /// Requests a single response came back for.
  int answered = 0;

  /// Responses that named an already answered request.
  int duplicates = 0;

  /// Responses that named a request this session never sent.
  int unsolicited = 0;

  /// Responses that did not name the request they answer.
  int misnamed = 0;

  /// Responses of type `error`.
  int errors = 0;

  /// A key no other request in this session shares.
  String key() => '$_prefix${_sequence++}';

  /// Sends [message] and completes with the one response that names it.
  Future<Map<String, Object?>> request(
    Map<String, Object?> message, {
    Duration timeout = const Duration(seconds: 20),
  }) {
    final key = '${message['requestId'] ?? message['id']}';
    if (!key.startsWith(_prefix)) {
      throw ArgumentError('$message carries no key from this session');
    }
    final completer = Completer<Map<String, Object?>>();
    _waiting[key] = completer;
    _echoes[key] = message.containsKey('requestId') ? 'requestId' : 'id';
    sent++;
    _phone.sendBridge(jsonEncode(message));
    return completer.future.timeout(
      timeout,
      onTimeout: () {
        _waiting.remove(key);
        _echoes.remove(key);
        throw TimeoutException('no response to $message');
      },
    );
  }

  /// Responses still owed, with the keys of the requests they belong to.
  List<String> get outstanding => _waiting.keys.toList();

  Future<void> dispose() => _subscription.cancel();

  void _onText(String text) {
    final decoded = jsonDecode(text);
    if (decoded is! Map) {
      return;
    }
    if (decoded['type'] == 'batch' && decoded['messages'] is List) {
      for (final message in decoded['messages'] as List<Object?>) {
        if (message is Map) {
          _accept(Map<String, Object?>.from(message));
        }
      }
      return;
    }
    _accept(Map<String, Object?>.from(decoded));
  }

  /// What a response is matched on, and what a frame that names nothing is.
  void _accept(Map<String, Object?> message) {
    final key = '${message['requestId'] ?? message['id']}';
    if (!key.startsWith(_prefix)) {
      if (message['requestId'] != null || message['id'] != null) {
        unsolicited++;
      }
      return;
    }
    if (_answered.contains(key)) {
      duplicates++;
      return;
    }
    final completer = _waiting.remove(key);
    if (completer == null) {
      unsolicited++;
      return;
    }
    if (message[_echoes.remove(key)] != key) {
      misnamed++;
    }
    _answered.add(key);
    answered++;
    if (message['type'] == 'error') {
      errors++;
    }
    completer.complete(message);
  }
}

/// `client_ping` → `client_pong`, echoed back with `id` (handlers/misc.ts).
Map<String, Object?> clientPing(String key, int sentAt) => <String, Object?>{
  'type': 'client_ping',
  'id': key,
  'sentAt': sentAt,
};

/// `list_devices` → `devices` (handlers/devices.ts).
Map<String, Object?> listDevices(String key) => <String, Object?>{
  'type': 'list_devices',
  'requestId': key,
};

/// `register_device` → `device_registered` (handlers/devices.ts).
Map<String, Object?> registerDevice(
  String key, {
  required String deviceId,
  required String deviceName,
  required String platform,
}) => <String, Object?>{
  'type': 'register_device',
  'requestId': key,
  'deviceId': deviceId,
  'deviceName': deviceName,
  'platform': platform,
};
