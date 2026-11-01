import 'dart:convert';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/stt_settings.dart';
import 'package:broski/models/terminal_settings.dart';
import 'package:broski/services/storage/broski_secure_storage.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class StorageService {
  static const _lastBrowsePathKey = 'broski_last_browse_path';
  static const _notificationsEnabledKey = 'broski_notifications_enabled';
  static const _selectedAgentTypeKey = 'broski_selected_agent_type';
  static const _sessionsTitleExcludeFiltersKey =
      'broski_sessions_title_exclude_filters';
  static const _sessionsTitleExcludeFiltersPrefix =
      'broski_sessions_title_exclude_filters_';

  // Highlight keys
  static const _highlightedProjectsKey = 'broski_highlighted_projects';
  static const _highlightedSessionsKey = 'broski_highlighted_sessions';
  static const _highlightColorKey = 'broski_highlight_color';

  // Prompt accent key
  static const _promptAccentColorKey = 'broski_prompt_accent_color';
  // Glow style key
  static const _glowStyleKey = 'broski_glow_style';

  // Card style keys
  static const _cardHeaderStyleKey = 'broski_card_header_style';
  static const _cardBorderVisibilityKey = 'broski_card_border_visibility';
  static const _terminalSettingsKey = 'broski_terminal_settings';
  static const _claudeCodeVariantKey = 'broski_claude_code_variant';

  // STT (Voice Input) keys
  static const _sttSettingsKey = 'broski_stt_settings';
  static const _sttGroqApiKeyKey = 'broski_stt_groq_api_key';
  static const _sttOpenaiApiKeyKey = 'broski_stt_openai_api_key';

  // Cache keys for offline mode
  static const _cachedPtySessionsKey = 'broski_cached_pty_sessions';
  static const _cachedCCSessionsKey = 'broski_cached_cc_sessions';
  static const _cachedCCMessagesPrefix = 'broski_cached_cc_messages_';
  static const _cachedSubagentsKey = 'broski_cached_subagents';
  static const _cachedCustomToolsKey = 'broski_cached_custom_tools';
  static const _cachedPluginsKey = 'broski_cached_plugins';
  static const _cachedCCProjectsKey = 'broski_cached_cc_projects';

  final FlutterSecureStorage _storage = broskiSecureStorage;

  // ============================================================
  // L1 In-Memory Cache (fastest - sub-millisecond reads)
  // ============================================================
  // Static so it persists across StorageService instances
  static final Map<String, dynamic> _memoryCache = {};

  // Cache timestamps for TTL-based skipping
  static final Map<String, DateTime> _cacheTimestamps = {};

  // Default TTL: 30 seconds (skip network if cache is fresh)
  static const Duration _defaultCacheTTL = Duration(seconds: 30);
  static const int _maxMemoryCacheEntries = 300;

  /// Clear all in-memory cache (call on logout/disconnect)
  void clearMemoryCache() {
    _memoryCache.clear();
    _cacheTimestamps.clear();
  }

  /// Clear all cached data (sessions, messages, projects, etc.)
  /// Preserves paired computers and user preferences.
  Future<void> clearCache() async {
    // Clear in-memory cache first
    clearMemoryCache();

    // Delete all cached data from secure storage
    final keysToDelete = [
      _cachedPtySessionsKey,
      _cachedCCSessionsKey,
      _cachedSubagentsKey,
      _cachedCustomToolsKey,
      _cachedPluginsKey,
      _cachedCCProjectsKey,
    ];

    for (final key in keysToDelete) {
      await _storage.delete(key: key);
    }
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
    if (_cacheTimestamps.length <= _maxMemoryCacheEntries) return;

    final entries = _cacheTimestamps.entries.toList()
      ..sort((a, b) => a.value.compareTo(b.value));
    final overflow = entries.length - _maxMemoryCacheEntries;
    for (var i = 0; i < overflow; i++) {
      final k = entries[i].key;
      _cacheTimestamps.remove(k);
      _memoryCache.remove(k);
    }
  }

  // ============================================================
  // Generic Cache Helpers (L1 + L2 two-tier caching)
  // ============================================================

  /// Cache a list of items (L1 memory + L2 secure storage).
  Future<void> _putList<T>(
    String key,
    List<T> items,
    Map<String, dynamic> Function(T) toJson,
  ) async {
    _memoryCache[key] = items;
    _updateCacheTimestamp(key);
    await _storage.write(
      key: key,
      value: jsonEncode(items.map(toJson).toList()),
    );
  }

  /// Load a cached list (L1 memory → L2 secure storage fallback).
  Future<List<T>> _getList<T>(
    String key,
    T Function(Map<String, dynamic>) fromJson,
  ) async {
    final mem = _memoryCache[key];
    if (mem is List<T>) return mem;
    final raw = await _storage.read(key: key);
    if (raw == null) return [];
    try {
      final items = (jsonDecode(raw) as List)
          .map((e) => fromJson(e as Map<String, dynamic>))
          .toList();
      _memoryCache[key] = items;
      return items;
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // Terminal Settings (PTY UX)
  // ============================================================

  Future<void> saveTerminalSettings(TerminalSettings settings) async {
    await _storage.write(
      key: _terminalSettingsKey,
      value: jsonEncode(settings.toJson()),
    );
  }

  Future<TerminalSettings?> loadTerminalSettings() async {
    final raw = await _storage.read(key: _terminalSettingsKey);
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        return TerminalSettings.fromJson(decoded);
      }
      if (decoded is Map) {
        return TerminalSettings.fromJson(decoded.cast<String, dynamic>());
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // ============================================================
  // Claude Code Variant Settings (thinking level)
  // ============================================================

  Future<void> saveClaudeCodeVariant(Map<String, dynamic> data) async {
    await _storage.write(key: _claudeCodeVariantKey, value: jsonEncode(data));
  }

  Future<Map<String, dynamic>?> loadClaudeCodeVariant() async {
    final raw = await _storage.read(key: _claudeCodeVariantKey);
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
      if (decoded is Map) {
        return decoded.cast<String, dynamic>();
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // ============================================================
  // STT (Voice Input) Settings
  // ============================================================

  /// Save STT settings (excluding API keys)
  Future<void> saveSttSettings(SttSettings settings) async {
    await _storage.write(
      key: _sttSettingsKey,
      value: jsonEncode(settings.toJson()),
    );
  }

  /// Load STT settings (excluding API keys)
  Future<SttSettings?> loadSttSettings() async {
    final raw = await _storage.read(key: _sttSettingsKey);
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        return SttSettings.fromJson(decoded);
      }
      if (decoded is Map) {
        return SttSettings.fromJson(decoded.cast<String, dynamic>());
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Save STT API key for a provider (securely stored)
  Future<void> saveSttApiKey(SttProvider provider, String apiKey) async {
    final key = provider == SttProvider.groq
        ? _sttGroqApiKeyKey
        : _sttOpenaiApiKeyKey;
    await _storage.write(key: key, value: apiKey);
  }

  /// Get STT API key for a provider
  Future<String?> getSttApiKey(SttProvider provider) async {
    final key = provider == SttProvider.groq
        ? _sttGroqApiKeyKey
        : _sttOpenaiApiKeyKey;
    return _storage.read(key: key);
  }

  /// Clear STT API key for a provider
  Future<void> clearSttApiKey(SttProvider provider) async {
    final key = provider == SttProvider.groq
        ? _sttGroqApiKeyKey
        : _sttOpenaiApiKeyKey;
    await _storage.delete(key: key);
  }

  // Generic string storage methods
  Future<String?> getString(String key) async {
    return _storage.read(key: key);
  }

  Future<void> setString(String key, String value) async {
    await _storage.write(key: key, value: value);
  }

  // Browse tab
  Future<String?> loadLastBrowsePath() async {
    return _storage.read(key: _lastBrowsePathKey);
  }

  Future<void> saveLastBrowsePath(String path) async {
    await _storage.write(key: _lastBrowsePathKey, value: path);
  }

  // ============================================================
  // Sessions Screen Preferences
  // ============================================================

  String _sessionsTitleExcludeFiltersKeyForAgent(AgentType agentType) =>
      '$_sessionsTitleExcludeFiltersPrefix${agentType.wireValue}';

  List<String> _decodeStringList(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        return decoded
            .map((e) => '$e')
            .map((s) => s.trim())
            .where((s) => s.isNotEmpty)
            .toList();
      }
    } catch (_) {}
    return const [];
  }

  Future<void> _maybeMigrateLegacyTitleFilters(
    AgentType requestingAgent,
  ) async {
    final legacyRaw = await _storage.read(key: _sessionsTitleExcludeFiltersKey);
    if (legacyRaw == null) return;

    final legacyFilters = _decodeStringList(legacyRaw);
    if (legacyFilters.isEmpty) {
      await _storage.delete(key: _sessionsTitleExcludeFiltersKey);
      return;
    }

    final selectedWire = await getSelectedAgentType();

    // Only migrate when the user is currently viewing the target backend.
    if (selectedWire != null && selectedWire != requestingAgent.wireValue) {
      return;
    }

    await _storage.write(
      key: _sessionsTitleExcludeFiltersKeyForAgent(requestingAgent),
      value: jsonEncode(legacyFilters),
    );
    await _storage.delete(key: _sessionsTitleExcludeFiltersKey);
  }

  Future<List<String>> getSessionsTitleExcludeFiltersForAgent(
    AgentType agentType,
  ) async {
    final key = _sessionsTitleExcludeFiltersKeyForAgent(agentType);
    var raw = await _storage.read(key: key);

    if (raw == null) {
      await _maybeMigrateLegacyTitleFilters(agentType);
      raw = await _storage.read(key: key);
    }

    if (raw == null) return const [];
    return _decodeStringList(raw);
  }

  Future<void> setSessionsTitleExcludeFiltersForAgent(
    AgentType agentType,
    List<String> filters,
  ) async {
    final normalized = filters
        .map((f) => f.trim())
        .where((f) => f.isNotEmpty)
        .toList();
    await _storage.write(
      key: _sessionsTitleExcludeFiltersKeyForAgent(agentType),
      value: jsonEncode(normalized),
    );
  }

  // ============================================================
  // Offline Mode Cache
  // ============================================================

  // Maximum messages to cache per session (context pruning)
  static const int _maxCachedMessagesPerSession = 50;

  // ============================================================
  // PTY Sessions Cache
  // ============================================================

  /// Cache PTY sessions list
  Future<void> cachePtySessions(List<Map<String, dynamic>> sessions) =>
      _putList(_cachedPtySessionsKey, sessions, (s) => s);

  /// Get cached PTY sessions
  Future<List<Map<String, dynamic>>> getCachedPtySessions() =>
      _getList(_cachedPtySessionsKey, (j) => j);

  // ============================================================
  // Claude Code Sessions Cache
  // ============================================================

  /// Cache Claude Code sessions list
  Future<void> cacheCCSessions(List<ClaudeCodeSession> sessions) =>
      _putList(_cachedCCSessionsKey, sessions, (s) => s.toJson());

  /// Get cached Claude Code sessions
  Future<List<ClaudeCodeSession>> getCachedCCSessions() =>
      _getList(_cachedCCSessionsKey, (j) => ClaudeCodeSession.fromJson(j));

  /// Cache Claude Code messages for a session (prunes to last 50)
  Future<void> cacheCCSessionMessages(
    String sessionId,
    List<ChatMessage> messages,
  ) async {
    final key = '$_cachedCCMessagesPrefix$sessionId';
    final pruned = messages.length > _maxCachedMessagesPerSession
        ? messages.sublist(messages.length - _maxCachedMessagesPerSession)
        : messages;
    await _putList(key, pruned, _messageToJson);
  }

  /// Get cached Claude Code messages for a session
  Future<List<ChatMessage>> getCachedCCMessages(String sessionId) =>
      _getList('$_cachedCCMessagesPrefix$sessionId', _messageFromJson);

  // ============================================================
  // Claude Code Projects Cache
  // ============================================================

  /// Cache Claude Code projects
  Future<void> cacheCCProjects(List<ProjectSummary> projects) =>
      _putList(_cachedCCProjectsKey, projects, _projectToJson);

  /// Load cached Claude Code projects
  Future<List<ProjectSummary>> getCachedCCProjects() =>
      _getList(_cachedCCProjectsKey, (j) => ProjectSummary.fromJson(j));

  // ============================================================
  // Subagents Cache
  // ============================================================

  /// Cache subagents config
  Future<void> cacheSubagents(List<ClaudeCodeSubagent> subagents) =>
      _putList(_cachedSubagentsKey, subagents, (s) => s.toJson());

  /// Get cached subagents
  Future<List<ClaudeCodeSubagent>> getCachedSubagents() =>
      _getList(_cachedSubagentsKey, (j) => ClaudeCodeSubagent.fromJson(j));

  // ============================================================
  // Custom Tools Cache
  // ============================================================

  /// Cache custom tools config
  Future<void> cacheCustomTools(List<ClaudeCodeCustomTool> tools) =>
      _putList(_cachedCustomToolsKey, tools, (t) => t.toJson());

  /// Get cached custom tools
  Future<List<ClaudeCodeCustomTool>> getCachedCustomTools() =>
      _getList(_cachedCustomToolsKey, (j) => ClaudeCodeCustomTool.fromJson(j));

  // ============================================================
  // Plugins Cache
  // ============================================================

  /// Cache plugins list
  Future<void> cachePlugins(List<ClaudeCodePlugin> plugins) =>
      _putList(_cachedPluginsKey, plugins, (p) => p.toJson());

  /// Get cached plugins
  Future<List<ClaudeCodePlugin>> getCachedPlugins() =>
      _getList(_cachedPluginsKey, (j) => ClaudeCodePlugin.fromJson(j));

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

  // ============================================================
  // Notification Settings
  // ============================================================

  /// Get notifications enabled setting (default: true)
  Future<bool> getNotificationsEnabled() async {
    final raw = await _storage.read(key: _notificationsEnabledKey);
    if (raw == null) return true; // Default ON
    return raw == 'true';
  }

  /// Set notifications enabled setting
  Future<void> setNotificationsEnabled(bool enabled) async {
    await _storage.write(
      key: _notificationsEnabledKey,
      value: enabled.toString(),
    );
  }

  Future<String?> getSelectedAgentType() async {
    return _storage.read(key: _selectedAgentTypeKey);
  }

  Future<void> setSelectedAgentType(String agentType) async {
    await _storage.write(key: _selectedAgentTypeKey, value: agentType);
  }

  // ============================================================
  // Highlight Settings
  // ============================================================

  /// Get highlighted project IDs
  Future<Set<String>> getHighlightedProjects() async {
    final raw = await _storage.read(key: _highlightedProjectsKey);
    if (raw == null) return {};
    try {
      final List<dynamic> list = jsonDecode(raw);
      return Set<String>.from(list.cast<String>());
    } catch (_) {
      return {};
    }
  }

  /// Save highlighted project IDs
  Future<void> saveHighlightedProjects(Set<String> projectIds) async {
    final json = jsonEncode(projectIds.toList());
    await _storage.write(key: _highlightedProjectsKey, value: json);
  }

  /// Get highlighted session IDs
  Future<Set<String>> getHighlightedSessions() async {
    final raw = await _storage.read(key: _highlightedSessionsKey);
    if (raw == null) return {};
    try {
      final List<dynamic> list = jsonDecode(raw);
      return Set<String>.from(list.cast<String>());
    } catch (_) {
      return {};
    }
  }

  /// Save highlighted session IDs
  Future<void> saveHighlightedSessions(Set<String> sessionIds) async {
    final json = jsonEncode(sessionIds.toList());
    await _storage.write(key: _highlightedSessionsKey, value: json);
  }

  /// Get selected highlight color
  Future<HighlightColor> getHighlightColor() async {
    final raw = await _storage.read(key: _highlightColorKey);
    return HighlightColor.fromString(raw);
  }

  /// Save selected highlight color
  Future<void> saveHighlightColor(HighlightColor color) async {
    await _storage.write(key: _highlightColorKey, value: color.name);
  }

  // ============================================================
  // Prompt Accent Color Settings
  // ============================================================

  /// Get selected prompt accent color
  Future<String?> getPromptAccentColor() async {
    return _storage.read(key: _promptAccentColorKey);
  }

  /// Save selected prompt accent color
  Future<void> savePromptAccentColor(String colorName) async {
    await _storage.write(key: _promptAccentColorKey, value: colorName);
  }

  /// Get selected glow style
  Future<String?> getGlowStyle() async {
    return _storage.read(key: _glowStyleKey);
  }

  /// Save selected glow style
  Future<void> saveGlowStyle(String styleName) async {
    await _storage.write(key: _glowStyleKey, value: styleName);
  }

  // ============================================================
  // Card Style Settings
  // ============================================================

  /// Get selected card header style
  Future<String?> getCardHeaderStyle() async {
    return _storage.read(key: _cardHeaderStyleKey);
  }

  /// Save selected card header style
  Future<void> saveCardHeaderStyle(String styleName) async {
    await _storage.write(key: _cardHeaderStyleKey, value: styleName);
  }

  /// Get selected card border visibility
  Future<String?> getCardBorderVisibility() async {
    return _storage.read(key: _cardBorderVisibilityKey);
  }

  /// Save selected card border visibility
  Future<void> saveCardBorderVisibility(String visibilityName) async {
    await _storage.write(key: _cardBorderVisibilityKey, value: visibilityName);
  }
}
