/// The prompts the bridge still holds when a socket registers.
///
/// `sessions_active` answers `register_device` with what is still waiting: the
/// session ids and request ids of every approval and elicitation the machine has
/// not resolved, plus the payload of the ones the bridge keeps for exactly this.
/// Each entry is restored as the event that shows it, and the ingest dedups by
/// request id — a prompt restored twice, or restored and then announced, costs
/// nothing.
library;

const _claudeCode = 'claude-code';
const _codex = 'codex';
const _opencode = 'opencode';

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
          request: {'requestId': id},
          at: at,
        ),
    for (final entry in _entriesOf(pending['claudeCodeElicitations']))
      if (_idOf(entry, 'requestId') case final id?)
        _elicitation(entry, requestId: id, at: at),
    for (final entry in _entriesOf(pending['codex']))
      if (_idOf(entry, 'requestId') case final id?)
        _approval(
          backend: _codex,
          sessionId: null,
          request: {'requestId': id},
          at: at,
        ),
    for (final entry in _entriesOf(pending['opencode']))
      if (_idOf(entry, 'requestId') case final id?)
        _approval(
          backend: _opencode,
          sessionId: _stringOr(entry['sessionId']),
          request: _mapOf(entry['request']) ?? {'requestId': id},
          at: at,
        ),
  ];
}

Map<String, dynamic> _approval({
  required String backend,
  required String? sessionId,
  required Map<String, dynamic> request,
  required int at,
}) => {
  'type': 'permission_requested',
  'backend': backend,
  'timestampMs': at,
  if (sessionId != null) 'sessionId': sessionId,
  'request': <String, dynamic>{'requestId': request['requestId'], ...request},
};

/// The elicitation prompt the bridge kept, so the restored one names the real
/// server, URL and message instead of a generic line.
Map<String, dynamic> _elicitation(
  Map<String, dynamic> entry, {
  required String requestId,
  required int at,
}) => {
  'type': 'backend_event',
  'backend': _claudeCode,
  'timestampMs': at,
  if (_stringOr(entry['sessionId']) case final sessionId?)
    'sessionId': sessionId,
  'kind': 'elicitation-request',
  'payload': <String, dynamic>{
    'requestId': requestId,
    if (_stringOr(entry['mcpServerName']) case final server?)
      'mcpServerName': server,
    if (_stringOr(entry['message']) case final message?) 'message': message,
    if (_stringOr(entry['mode']) case final mode?) 'mode': mode,
    if (_stringOr(entry['url']) case final url?) 'url': url,
    if (_stringOr(entry['elicitationId']) case final id?) 'elicitationId': id,
    if (entry['requestedSchema'] != null)
      'requestedSchema': entry['requestedSchema'],
  },
};

/// Codex waiters are keyed by the request id alone, so an entry is that string.
Iterable<Map<String, dynamic>> _entriesOf(Object? raw) sync* {
  if (raw is! List) return;
  for (final entry in raw) {
    final map = _mapOf(entry);
    if (map != null) {
      yield map;
    } else if (entry is String && entry.trim().isNotEmpty) {
      yield {'requestId': entry.trim()};
    }
  }
}

Map<String, dynamic>? _mapOf(Object? value) {
  if (value is! Map) return null;
  return value.map((key, entry) => MapEntry(key.toString(), entry));
}

String? _idOf(Map<String, dynamic> entry, String key) => _stringOr(entry[key]);

String? _stringOr(Object? value) {
  final text = value is String ? value.trim() : '';
  return text.isEmpty ? null : text;
}
