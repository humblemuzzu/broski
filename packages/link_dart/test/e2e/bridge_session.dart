import 'dart:async';
import 'dart:convert';

import 'package:test/test.dart';

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

/// `unified_list_sessions` → `unified_sessions` (handlers/unified.ts): one
/// reply, whichever backend it names.
Map<String, Object?> unifiedListSessions(
  String key, {
  required String backend,
  String? cwd,
}) => <String, Object?>{
  'type': 'unified_list_sessions',
  'requestId': key,
  'backend': backend,
  if (cwd != null) 'cwd': cwd,
};

/// `cc_get_session_messages` → `cc_session_messages`. With `limit` (and then
/// optionally `before`) the bridge answers one page and reports `hasMore`,
/// `nextCursor`; without it, the whole transcript.
Map<String, Object?> ccGetSessionMessages(
  String key, {
  required String sessionId,
  required String cwd,
  int? limit,
  String? before,
}) => <String, Object?>{
  'type': 'cc_get_session_messages',
  'requestId': key,
  'sessionId': sessionId,
  'cwd': cwd,
  if (limit != null) 'limit': limit,
  if (before != null) 'before': before,
};

/// `set_view`, which the app sends when it opens a chat. It has no reply.
Map<String, Object?> setView({
  required String sessionId,
  required String cwd,
  String agent = 'claude-code',
}) => <String, Object?>{
  'type': 'set_view',
  'agent': agent,
  'projectPath': cwd,
  'sessionId': sessionId,
};

/// Asserts the correlator saw one reply per request and nothing else.
void expectCleanReplies(BridgeSession session) {
  expect(session.misnamed, 0, reason: 'every reply names its request');
  expect(session.duplicates, 0, reason: 'nothing arrived twice');
  expect(session.unsolicited, 0, reason: 'nothing named an unknown request');
  expect(
    session.errors,
    0,
    reason: 'the bridge answered no request with an error',
  );
  expect(session.outstanding, isEmpty, reason: 'every request was answered');
}

/// `pi_new_session` → `pi_session_created` (handlers/pi_session_lifecycle.ts).
Map<String, Object?> piNewSession(
  String key, {
  required String projectPath,
  required String provider,
  required String modelId,
}) => <String, Object?>{
  'type': 'pi_new_session',
  'requestId': key,
  'projectPath': projectPath,
  'provider': provider,
  'modelId': modelId,
  'thinkingLevel': 'high',
};

/// `pi_chat` → `pi_chat_started`, then `runtime_event`s (handlers/pi_chat.ts).
Map<String, Object?> piChat(
  String key, {
  required String projectPath,
  required String prompt,
}) => <String, Object?>{
  'type': 'pi_chat',
  'requestId': key,
  'projectPath': projectPath,
  'prompt': prompt,
};

/// `pi_abort` → `pi_aborted` (handlers/pi_chat.ts).
Map<String, Object?> piAbort(String key, {required String projectPath}) =>
    <String, Object?>{
      'type': 'pi_abort',
      'requestId': key,
      'projectPath': projectPath,
    };
