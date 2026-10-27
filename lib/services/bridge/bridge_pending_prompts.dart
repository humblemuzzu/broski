/// The prompts the bridge still holds when a socket registers.
///
/// `sessions_active` answers `register_device` with what is still waiting: the
/// session ids and request ids of every approval and elicitation the machine has
/// not resolved. Only the ids survive, so each is restored as the smallest
/// prompt that can still be answered, and the ingest dedups by request id — a
/// prompt restored twice, or restored and then announced, costs nothing.
library;

const _claudeCode = 'claude-code';
const _codex = 'codex';

/// The runtime event payloads one `sessions_active` reply stands for.
List<Map<String, dynamic>> pendingPromptPayloads(Object? data, {int? nowMs}) {
  if (data is! Map) return const [];
  final pending = data['pendingPermissions'];
  if (pending is! Map) return const [];
  final at = nowMs ?? DateTime.now().millisecondsSinceEpoch;
  return [
    for (final entry in _entriesOf(pending['claudeCode']))
      if (_idOf(entry, 'toolUseId') case final id?)
        _approval(
          backend: _claudeCode,
          sessionId: _stringOr(entry['sessionId']),
          requestId: id,
          at: at,
        ),
    for (final entry in _entriesOf(pending['claudeCodeElicitations']))
      if (_idOf(entry, 'requestId') case final id?)
        _elicitation(
          sessionId: _stringOr(entry['sessionId']),
          requestId: id,
          at: at,
        ),
    for (final entry in _entriesOf(pending['codex']))
      if (_idOf(entry, 'requestId') case final id?)
        _approval(backend: _codex, sessionId: null, requestId: id, at: at),
  ];
}

Map<String, dynamic> _approval({
  required String backend,
  required String? sessionId,
  required String requestId,
  required int at,
}) => {
  'type': 'permission_requested',
  'backend': backend,
  'timestampMs': at,
  if (sessionId != null) 'sessionId': sessionId,
  'request': <String, dynamic>{'requestId': requestId},
};

Map<String, dynamic> _elicitation({
  required String? sessionId,
  required String requestId,
  required int at,
}) => {
  'type': 'backend_event',
  'backend': _claudeCode,
  'timestampMs': at,
  if (sessionId != null) 'sessionId': sessionId,
  'kind': 'elicitation-request',
  'payload': <String, dynamic>{
    'requestId': requestId,
    'message': 'MCP authentication is still waiting for an answer',
  },
};

/// Codex waiters are keyed by the request id alone, so an entry is that string.
Iterable<Map<String, dynamic>> _entriesOf(Object? raw) sync* {
  if (raw is! List) return;
  for (final entry in raw) {
    if (entry is Map) {
      yield entry.map((key, value) => MapEntry(key.toString(), value));
    } else if (entry is String && entry.trim().isNotEmpty) {
      yield {'requestId': entry.trim()};
    }
  }
}

String? _idOf(Map<String, dynamic> entry, String key) => _stringOr(entry[key]);

String? _stringOr(Object? value) {
  final text = value is String ? value.trim() : '';
  return text.isEmpty ? null : text;
}
