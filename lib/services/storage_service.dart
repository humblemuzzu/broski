import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/connection.dart';
import '../models/message.dart';
import '../models/project.dart';
import '../models/session.dart';

class StorageService {
  static const _connectionKey = 'broski_connection';
  static const _disabledToolsKey = 'broski_disabled_tools';
  static const _lastBrowsePathKey = 'broski_last_browse_path';

  // Cache keys for offline mode
  static const _cachedProjectsKey = 'broski_cached_projects';
  static const _cachedSessionsKey = 'broski_cached_sessions';
  static const _cachedMessagesPrefix = 'broski_cached_messages_';

  final FlutterSecureStorage _storage = const FlutterSecureStorage();

  // ============================================================
  // L1 In-Memory Cache (fastest - sub-millisecond reads)
  // ============================================================
  // Static so it persists across StorageService instances
  static final Map<String, dynamic> _memoryCache = {};

  // Cache timestamps for TTL-based skipping
  static final Map<String, DateTime> _cacheTimestamps = {};

  // Default TTL: 30 seconds (skip network if cache is fresh)
  static const Duration _defaultCacheTTL = Duration(seconds: 30);

  /// Clear all in-memory cache (call on logout/disconnect)
  void clearMemoryCache() {
    _memoryCache.clear();
    _cacheTimestamps.clear();
  }

  /// Check if cache is still fresh (within TTL)
  bool isCacheFresh(String key, {Duration? ttl}) {
    final timestamp = _cacheTimestamps[key];
    if (timestamp == null) return false;
    final effectiveTtl = ttl ?? _defaultCacheTTL;
    return DateTime.now().difference(timestamp) < effectiveTtl;
  }

  /// Get cache age in milliseconds (for debugging/metrics)
  int? getCacheAgeMs(String key) {
    final timestamp = _cacheTimestamps[key];
    if (timestamp == null) return null;
    return DateTime.now().difference(timestamp).inMilliseconds;
  }

  /// Mark cache as updated (set timestamp)
  void _updateCacheTimestamp(String key) {
    _cacheTimestamps[key] = DateTime.now();
  }

  /// Check if sessions cache is fresh (can skip network)
  bool isSessionsCacheFresh() => isCacheFresh(_cachedSessionsKey);

  /// Check if projects cache is fresh (can skip network)
  bool isProjectsCacheFresh() => isCacheFresh(_cachedProjectsKey);

  Future<void> saveConnection(ConnectionInfo info) async {
    await _storage.write(key: _connectionKey, value: jsonEncode(info.toJson()));
  }

  Future<ConnectionInfo?> loadConnection() async {
    final raw = await _storage.read(key: _connectionKey);
    if (raw == null) return null;
    final data = jsonDecode(raw) as Map<String, dynamic>;
    return ConnectionInfo.fromJson(data);
  }

  Future<void> clearConnection() async {
    await _storage.delete(key: _connectionKey);
  }

  // Generic string storage methods
  Future<String?> getString(String key) async {
    return _storage.read(key: key);
  }

  Future<void> setString(String key, String value) async {
    await _storage.write(key: key, value: value);
  }

  // Tool settings
  Future<Set<String>> getDisabledTools() async {
    final raw = await _storage.read(key: _disabledToolsKey);
    if (raw == null) return {};
    try {
      final List<dynamic> list = jsonDecode(raw);
      return Set<String>.from(list.cast<String>());
    } catch (_) {
      return {};
    }
  }

  Future<void> saveDisabledTools(Set<String> disabledTools) async {
    final json = jsonEncode(disabledTools.toList());
    await _storage.write(key: _disabledToolsKey, value: json);
  }

  // Browse tab
  Future<String?> loadLastBrowsePath() async {
    return _storage.read(key: _lastBrowsePathKey);
  }

  Future<void> saveLastBrowsePath(String path) async {
    await _storage.write(key: _lastBrowsePathKey, value: path);
  }

  // ============================================================
  // Offline Mode Cache
  // ============================================================

  /// Cache projects for offline viewing
  /// Uses L1 (memory) + L2 (secure storage) tiered caching
  Future<void> cacheProjects(List<ProjectSummary> projects) async {
    // L1: Store in memory for instant access
    _memoryCache[_cachedProjectsKey] = projects;
    _updateCacheTimestamp(_cachedProjectsKey);

    // L2: Persist to secure storage (async, non-blocking)
    final json = jsonEncode(projects.map((p) => _projectToJson(p)).toList());
    await _storage.write(key: _cachedProjectsKey, value: json);
  }

  /// Load cached projects
  /// Checks L1 (memory) first, falls back to L2 (secure storage)
  Future<List<ProjectSummary>> getCachedProjects() async {
    // L1: Check memory cache first (sub-millisecond)
    final memCached = _memoryCache[_cachedProjectsKey];
    if (memCached != null && memCached is List<ProjectSummary>) {
      return memCached;
    }

    // L2: Fall back to secure storage
    final raw = await _storage.read(key: _cachedProjectsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final projects = list
          .map((item) => ProjectSummary.fromJson(item as Map<String, dynamic>))
          .toList();
      // Promote to L1 cache for next read
      _memoryCache[_cachedProjectsKey] = projects;
      return projects;
    } catch (_) {
      return [];
    }
  }

  /// Cache sessions for offline viewing
  /// Uses L1 (memory) + L2 (secure storage) tiered caching
  Future<void> cacheSessions(List<SessionSummary> sessions) async {
    // L1: Store in memory for instant access
    _memoryCache[_cachedSessionsKey] = sessions;
    _updateCacheTimestamp(_cachedSessionsKey);

    // L2: Persist to secure storage (async, non-blocking)
    final json = jsonEncode(sessions.map((s) => _sessionToJson(s)).toList());
    await _storage.write(key: _cachedSessionsKey, value: json);
  }

  /// Load cached sessions
  /// Checks L1 (memory) first, falls back to L2 (secure storage)
  Future<List<SessionSummary>> getCachedSessions() async {
    // L1: Check memory cache first (sub-millisecond)
    final memCached = _memoryCache[_cachedSessionsKey];
    if (memCached != null && memCached is List<SessionSummary>) {
      return memCached;
    }

    // L2: Fall back to secure storage
    final raw = await _storage.read(key: _cachedSessionsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final sessions = list
          .map((item) => SessionSummary.fromJson(item as Map<String, dynamic>))
          .toList();
      // Promote to L1 cache for next read
      _memoryCache[_cachedSessionsKey] = sessions;
      return sessions;
    } catch (_) {
      return [];
    }
  }

  // Maximum messages to cache per session (context pruning)
  static const int _maxCachedMessagesPerSession = 50;

  /// Cache messages for a specific session
  /// Uses L1 (memory) + L2 (secure storage) tiered caching
  /// Prunes old messages to prevent memory bloat (keeps last 50)
  Future<void> cacheSessionMessages(
    String sessionId,
    List<ChatMessage> messages,
  ) async {
    final key = '$_cachedMessagesPrefix$sessionId';

    // Prune to last N messages (keep most recent)
    final prunedMessages = messages.length > _maxCachedMessagesPerSession
        ? messages.sublist(messages.length - _maxCachedMessagesPerSession)
        : messages;

    // L1: Store in memory
    _memoryCache[key] = prunedMessages;
    _updateCacheTimestamp(key);

    // L2: Persist to secure storage
    final json = jsonEncode(
      prunedMessages.map((m) => _messageToJson(m)).toList(),
    );
    await _storage.write(key: key, value: json);
  }

  /// Load cached messages for a session
  /// Checks L1 (memory) first, falls back to L2 (secure storage)
  Future<List<ChatMessage>> getCachedMessages(String sessionId) async {
    final key = '$_cachedMessagesPrefix$sessionId';

    // L1: Check memory cache first
    final memCached = _memoryCache[key];
    if (memCached != null && memCached is List<ChatMessage>) {
      return memCached;
    }

    // L2: Fall back to secure storage
    final raw = await _storage.read(key: key);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final messages = list
          .map((item) => _messageFromJson(item as Map<String, dynamic>))
          .toList();
      // Promote to L1 cache
      _memoryCache[key] = messages;
      return messages;
    } catch (_) {
      return [];
    }
  }

  /// Check if we have any cached data for offline mode
  Future<bool> hasCachedData() async {
    final projects = await _storage.read(key: _cachedProjectsKey);
    final sessions = await _storage.read(key: _cachedSessionsKey);
    return (projects != null && projects.isNotEmpty) ||
        (sessions != null && sessions.isNotEmpty);
  }

  // ============================================================
  // JSON Serialization Helpers
  // ============================================================

  Map<String, dynamic> _projectToJson(ProjectSummary p) {
    return {
      'id': p.id,
      'name': p.name,
      'path': p.path,
      'lastOpened': p.lastOpened,
    };
  }

  Map<String, dynamic> _sessionToJson(SessionSummary s) {
    return {
      'id': s.id,
      'title': s.title,
      'projectID': s.projectID,
      'directory': s.directory,
      'parentID': s.parentID,
      'time': {
        'created': s.time.created,
        'updated': s.time.updated,
        'compacting': s.time.compacting,
      },
      'summary': s.summary == null
          ? null
          : {
              'additions': s.summary!.additions,
              'deletions': s.summary!.deletions,
              'files': s.summary!.files,
            },
      'share': s.share == null ? null : {'url': s.share!.url},
    };
  }

  Map<String, dynamic> _messageToJson(ChatMessage m) {
    return {
      'id': m.id,
      'sessionId': m.sessionId,
      'role': m.role.name,
      'createdAt': m.createdAt.millisecondsSinceEpoch,
      'text': m.text,
      'error': m.error,
      'toolCalls': m.toolCalls.map((t) => _toolCallToJson(t)).toList(),
      'diffs': m.diffs.map((d) => _diffToJson(d)).toList(),
    };
  }

  Map<String, dynamic> _toolCallToJson(ToolCall t) {
    return {
      'callId': t.callId,
      'partId': t.partId,
      'name': t.name,
      'status': t.status,
      'title': t.title,
      'input': t.input,
      'output': t.output,
      'metadata': t.metadata,
    };
  }

  Map<String, dynamic> _diffToJson(DiffEntry d) {
    return {
      'file': d.file,
      'before': d.before,
      'after': d.after,
      'additions': d.additions,
      'deletions': d.deletions,
      'diff': d.diff,
      'partId': d.partId,
    };
  }

  ChatMessage _messageFromJson(Map<String, dynamic> json) {
    final roleStr = json['role'] as String? ?? 'assistant';
    final role = MessageRole.values.firstWhere(
      (r) => r.name == roleStr,
      orElse: () => MessageRole.assistant,
    );

    return ChatMessage(
      id: json['id'] as String? ?? '',
      sessionId: json['sessionId'] as String? ?? '',
      role: role,
      createdAt: DateTime.fromMillisecondsSinceEpoch(
        json['createdAt'] as int? ?? 0,
      ),
      text: json['text'] as String? ?? '',
      error: json['error'] as String?,
      toolCalls: (json['toolCalls'] as List<dynamic>? ?? [])
          .map((t) => _toolCallFromJson(t as Map<String, dynamic>))
          .toList(),
      diffs: (json['diffs'] as List<dynamic>? ?? [])
          .map((d) => _diffFromJson(d as Map<String, dynamic>))
          .toList(),
    );
  }

  ToolCall _toolCallFromJson(Map<String, dynamic> json) {
    return ToolCall(
      callId: json['callId'] as String? ?? '',
      partId: json['partId'] as String? ?? '',
      name: json['name'] as String? ?? '',
      status: json['status'] as String? ?? 'completed',
      title: json['title'] as String?,
      input: (json['input'] as Map<String, dynamic>?) ?? const {},
      output: json['output'] as String?,
      metadata: (json['metadata'] as Map<String, dynamic>?) ?? const {},
    );
  }

  DiffEntry _diffFromJson(Map<String, dynamic> json) {
    return DiffEntry(
      file: json['file'] as String? ?? '',
      before: json['before'] as String? ?? '',
      after: json['after'] as String? ?? '',
      additions: json['additions'] as int? ?? 0,
      deletions: json['deletions'] as int? ?? 0,
      diff: json['diff'] as String?,
      partId: json['partId'] as String?,
    );
  }
}
