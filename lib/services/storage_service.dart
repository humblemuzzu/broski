import 'dart:convert';

import 'package:broski/models/agent.dart';
import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/command.dart';
import 'package:broski/models/connection.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/models/mcp.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/permission_rule.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/provider.dart';
import 'package:broski/models/session.dart';
import 'package:broski/models/session_context.dart';
import 'package:broski/models/stt_settings.dart';
import 'package:broski/models/terminal_settings.dart';
import 'package:broski/models/todo.dart';
import 'package:broski/models/tool.dart';
import 'package:broski/models/vcs.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

class StorageService {
  static const _connectionKey = 'broski_connection';
  static const _connectionAuthTokenKey = 'broski_connection_auth_token';
  static const _appSessionTokenKey = 'broski_app_session_token';
  static const _appUserIdKey = 'broski_app_user_id';
  static const _disabledToolsKey = 'broski_disabled_tools';
  static const _lastBrowsePathKey = 'broski_last_browse_path';
  static const _notificationsEnabledKey = 'broski_notifications_enabled';
  static const _deviceIdKey = 'broski_device_id';
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
  static const _codexSettingsKey = 'broski_codex_settings';
  static const _terminalSettingsKey = 'broski_terminal_settings';
  static const _permissionRulesKey = 'broski_permission_rules';
  static const _openCodeVariantsKey = 'broski_opencode_variants';
  static const _claudeCodeVariantKey = 'broski_claude_code_variant';

  // STT (Voice Input) keys
  static const _sttSettingsKey = 'broski_stt_settings';
  static const _sttGroqApiKeyKey = 'broski_stt_groq_api_key';
  static const _sttOpenaiApiKeyKey = 'broski_stt_openai_api_key';

  static const _uuid = Uuid();

  // Cache keys for offline mode
  static const _cachedProjectsKey = 'broski_cached_projects';
  static const _cachedSessionsKey = 'broski_cached_sessions';
  static const _cachedMessagesPrefix = 'broski_cached_messages_';

  // Extended offline cache keys
  static const _cachedSessionContextPrefix = 'broski_cached_context_';
  static const _cachedTodosPrefix = 'broski_cached_todos_';
  static const _cachedVcsPrefix = 'broski_cached_vcs_';
  static const _cachedAgentsKey = 'broski_cached_agents';
  static const _cachedCommandsKey = 'broski_cached_commands';
  static const _cachedToolsKey = 'broski_cached_tools';
  static const _cachedMcpServersKey = 'broski_cached_mcp_servers';
  static const _cachedProvidersKey = 'broski_cached_providers';
  static const _cachedProviderAuthKey = 'broski_cached_provider_auth';
  static const _cachedPtySessionsKey = 'broski_cached_pty_sessions';
  static const _cachedCCSessionsKey = 'broski_cached_cc_sessions';
  static const _cachedCCMessagesPrefix = 'broski_cached_cc_messages_';
  static const _cachedCodexModelsKey = 'broski_cached_codex_models';
  static const _cachedCodexProjectsKey = 'broski_cached_codex_projects';
  static const _cachedCodexThreadsKey = 'broski_cached_codex_threads';
  static const _cachedCodexMessagesPrefix = 'broski_cached_codex_messages_';
  static const _cachedSubagentsKey = 'broski_cached_subagents';
  static const _cachedCustomToolsKey = 'broski_cached_custom_tools';
  static const _cachedPluginsKey = 'broski_cached_plugins';
  static const _cachedPiSessionsKey = 'broski_cached_pi_sessions';
  static const _cachedPiProjectsKey = 'broski_cached_pi_projects';
  static const _cachedCCProjectsKey = 'broski_cached_cc_projects';

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
  static const int _maxMemoryCacheEntries = 300;

  /// Clear all in-memory cache (call on logout/disconnect)
  void clearMemoryCache() {
    _memoryCache.clear();
    _cacheTimestamps.clear();
  }

  /// Clear all cached data (sessions, messages, projects, etc.)
  /// Preserves connection credentials and user preferences.
  Future<void> clearCache() async {
    // Clear in-memory cache first
    clearMemoryCache();

    // Delete all cached data from secure storage
    final keysToDelete = [
      _cachedProjectsKey,
      _cachedSessionsKey,
      _cachedAgentsKey,
      _cachedCommandsKey,
      _cachedToolsKey,
      _cachedMcpServersKey,
      _cachedProvidersKey,
      _cachedProviderAuthKey,
      _cachedPtySessionsKey,
      _cachedCCSessionsKey,
      _cachedCodexModelsKey,
      _cachedCodexProjectsKey,
      _cachedCodexThreadsKey,
      _cachedSubagentsKey,
      _cachedCustomToolsKey,
      _cachedPluginsKey,
      _cachedPiSessionsKey,
      _cachedPiProjectsKey,
      _cachedCCProjectsKey,
    ];

    for (final key in keysToDelete) {
      await _storage.delete(key: key);
    }

    // Delete all prefixed cache entries (messages, context, todos, vcs)
    // Note: flutter_secure_storage doesn't support listing keys,
    // so we delete known patterns
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

  /// Cache a single object (L1 memory + L2 secure storage).
  Future<void> _putObject<T>(
    String key,
    T item,
    Map<String, dynamic> Function(T) toJson,
  ) async {
    _memoryCache[key] = item;
    _updateCacheTimestamp(key);
    await _storage.write(key: key, value: jsonEncode(toJson(item)));
  }

  /// Load a cached object (L1 memory → L2 secure storage fallback).
  Future<T?> _getObject<T>(
    String key,
    T Function(Map<String, dynamic>) fromJson,
  ) async {
    final mem = _memoryCache[key];
    if (mem is T) return mem;
    final raw = await _storage.read(key: key);
    if (raw == null) return null;
    try {
      final obj = fromJson(jsonDecode(raw) as Map<String, dynamic>);
      _memoryCache[key] = obj;
      return obj;
    } catch (_) {
      return null;
    }
  }

  /// Check if sessions cache is fresh (can skip network)
  bool isSessionsCacheFresh() => isCacheFresh(_cachedSessionsKey);

  /// Check if projects cache is fresh (can skip network)
  bool isProjectsCacheFresh() => isCacheFresh(_cachedProjectsKey);

  Future<void> saveConnection(ConnectionInfo info) async {
    final json = info.toJson();
    final authToken = json['authToken'] as String?;
    json.remove('authToken');
    await _storage.write(key: _connectionKey, value: jsonEncode(json));
    if (authToken != null && authToken.isNotEmpty) {
      await _storage.write(key: _connectionAuthTokenKey, value: authToken);
    } else {
      await _storage.delete(key: _connectionAuthTokenKey);
    }
  }

  // ============================================================
  // Phase 4: Session Permission Presets (OpenCode)
  // ============================================================

  Future<void> savePermissionRules({
    required PermissionPreset preset,
    required PermissionRuleset customRules,
  }) async {
    final payload = <String, dynamic>{
      'preset': preset.name,
      'customRules': customRules.map((r) => r.toJson()).toList(),
    };
    await _storage.write(key: _permissionRulesKey, value: jsonEncode(payload));
  }

  Future<({PermissionPreset preset, PermissionRuleset customRules})?>
  loadPermissionRules() async {
    final raw = await _storage.read(key: _permissionRulesKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      final presetName = json['preset'] as String? ?? 'askEverything';
      final preset = PermissionPreset.values.firstWhere(
        (p) => p.name == presetName,
        orElse: () => PermissionPreset.askEverything,
      );
      final custom =
          (json['customRules'] as List<dynamic>?)
              ?.whereType<Map<String, dynamic>>()
              .map(PermissionRule.fromJson)
              .toList() ??
          <PermissionRule>[];
      return (preset: preset, customRules: custom);
    } catch (_) {
      return null;
    }
  }

  // ============================================================
  // Codex Settings (app-side defaults; applied programmatically)
  // ============================================================

  Future<void> saveCodexSettings(CodexSettings settings) async {
    await _storage.write(key: _codexSettingsKey, value: jsonEncode(settings));
  }

  Future<CodexSettings?> loadCodexSettings() async {
    final raw = await _storage.read(key: _codexSettingsKey);
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map<String, dynamic>) {
        return CodexSettings.fromJson(decoded);
      }
      if (decoded is Map) {
        return CodexSettings.fromJson(decoded.cast<String, dynamic>());
      }
      return null;
    } catch (_) {
      return null;
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
  // OpenCode Variant Settings (thinking levels per model)
  // ============================================================

  Future<void> saveOpenCodeVariants(Map<String, dynamic> data) async {
    await _storage.write(key: _openCodeVariantsKey, value: jsonEncode(data));
  }

  Future<Map<String, dynamic>?> loadOpenCodeVariants() async {
    final raw = await _storage.read(key: _openCodeVariantsKey);
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

  Future<ConnectionInfo?> loadConnection() async {
    final raw = await _storage.read(key: _connectionKey);
    if (raw == null) return null;
    final data = jsonDecode(raw) as Map<String, dynamic>;
    final token = await _storage.read(key: _connectionAuthTokenKey);
    // Back-compat: older versions stored authToken inside the JSON blob.
    final legacyToken = data['authToken'] as String?;
    final effectiveToken = (token != null && token.isNotEmpty)
        ? token
        : (legacyToken != null && legacyToken.isNotEmpty ? legacyToken : null);
    if (effectiveToken != null) {
      data['authToken'] = effectiveToken;
      // Best-effort migration to separate key.
      if (token == null || token.isEmpty) {
        await _storage.write(
          key: _connectionAuthTokenKey,
          value: effectiveToken,
        );
        data.remove('authToken');
        await _storage.write(key: _connectionKey, value: jsonEncode(data));
        data['authToken'] = effectiveToken;
      }
    }
    return ConnectionInfo.fromJson(data);
  }

  Future<void> clearConnection() async {
    await _storage.delete(key: _connectionKey);
    await _storage.delete(key: _connectionAuthTokenKey);
  }

  // ============================================================
  // App Auth (Convex session)
  // ============================================================

  Future<String?> getAppSessionToken() async {
    final token = await _storage.read(key: _appSessionTokenKey);
    return (token != null && token.isNotEmpty) ? token : null;
  }

  Future<void> setAppSessionToken(String token) async {
    await _storage.write(key: _appSessionTokenKey, value: token);
  }

  Future<void> clearAppSessionToken() async {
    await _storage.delete(key: _appSessionTokenKey);
  }

  Future<String?> getAppUserId() async {
    final id = await _storage.read(key: _appUserIdKey);
    return (id != null && id.isNotEmpty) ? id : null;
  }

  Future<void> setAppUserId(String appUserId) async {
    await _storage.write(key: _appUserIdKey, value: appUserId);
  }

  Future<void> clearAppUserId() async {
    await _storage.delete(key: _appUserIdKey);
  }

  Future<void> clearAppAuth() async {
    await clearAppSessionToken();
    await clearAppUserId();
  }

  Future<String> getOrCreateDeviceId() async {
    final existing = await _storage.read(key: _deviceIdKey);
    if (existing != null && existing.isNotEmpty) {
      return existing;
    }
    final newId = _uuid.v4();
    await _storage.write(key: _deviceIdKey, value: newId);
    return newId;
  }

  Future<String?> getDeviceId() async {
    return _storage.read(key: _deviceIdKey);
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
    final targetAgent = selectedWire != null
        ? AgentType.fromWireValue(selectedWire)
        : requestingAgent;

    // Only migrate when the user is currently viewing the target backend.
    if (targetAgent != requestingAgent) return;

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

  /// Legacy API: defaults to OpenCode filters.
  Future<List<String>> getSessionsTitleExcludeFilters() async {
    return getSessionsTitleExcludeFiltersForAgent(AgentType.opencode);
  }

  /// Legacy API: defaults to OpenCode filters.
  Future<void> setSessionsTitleExcludeFilters(List<String> filters) async {
    return setSessionsTitleExcludeFiltersForAgent(AgentType.opencode, filters);
  }

  // ============================================================
  // Offline Mode Cache
  // ============================================================

  // Maximum messages to cache per session (context pruning)
  static const int _maxCachedMessagesPerSession = 50;

  /// Cache projects for offline viewing
  Future<void> cacheProjects(List<ProjectSummary> projects) =>
      _putList(_cachedProjectsKey, projects, _projectToJson);

  /// Load cached projects
  Future<List<ProjectSummary>> getCachedProjects() =>
      _getList(_cachedProjectsKey, (j) => ProjectSummary.fromJson(j));

  /// Cache Codex models returned by `model/list`.
  Future<void> cacheCodexModels(List<Map<String, dynamic>> models) =>
      _putList(_cachedCodexModelsKey, models, (m) => m);

  /// Load cached Codex models.
  Future<List<Map<String, dynamic>>> getCachedCodexModels() =>
      _getList(_cachedCodexModelsKey, (j) => j);

  /// Cache Codex projects (derived from Codex thread cwd values)
  Future<void> cacheCodexProjects(List<ProjectSummary> projects) =>
      _putList(_cachedCodexProjectsKey, projects, _projectToJson);

  /// Load cached Codex projects
  Future<List<ProjectSummary>> getCachedCodexProjects() =>
      _getList(_cachedCodexProjectsKey, (j) => ProjectSummary.fromJson(j));

  /// Cache sessions for offline viewing
  Future<void> cacheSessions(List<SessionSummary> sessions) =>
      _putList(_cachedSessionsKey, sessions, _sessionToJson);

  /// Load cached sessions
  Future<List<SessionSummary>> getCachedSessions() =>
      _getList(_cachedSessionsKey, (j) => SessionSummary.fromJson(j));

  /// Cache messages for a specific session (prunes to last 50)
  Future<void> cacheSessionMessages(
    String sessionId,
    List<ChatMessage> messages,
  ) async {
    final key = '$_cachedMessagesPrefix$sessionId';
    final pruned = messages.length > _maxCachedMessagesPerSession
        ? messages.sublist(messages.length - _maxCachedMessagesPerSession)
        : messages;
    await _putList(key, pruned, _messageToJson);
  }

  /// Load cached messages for a session
  Future<List<ChatMessage>> getCachedMessages(String sessionId) =>
      _getList('$_cachedMessagesPrefix$sessionId', _messageFromJson);

  /// Check if we have any cached data for offline mode
  Future<bool> hasCachedData() async {
    final projects = await _storage.read(key: _cachedProjectsKey);
    final sessions = await _storage.read(key: _cachedSessionsKey);
    final codexProjects = await _storage.read(key: _cachedCodexProjectsKey);
    final codexThreads = await _storage.read(key: _cachedCodexThreadsKey);
    return (projects != null && projects.isNotEmpty) ||
        (sessions != null && sessions.isNotEmpty) ||
        (codexProjects != null && codexProjects.isNotEmpty) ||
        (codexThreads != null && codexThreads.isNotEmpty);
  }

  // ============================================================
  // Session Context Cache (tokens, LSP, modified files)
  // ============================================================

  /// Cache session context for a specific session
  Future<void> cacheSessionContext(String sessionId, SessionContext context) =>
      _putObject(
        '$_cachedSessionContextPrefix$sessionId',
        context,
        _sessionContextToJson,
      );

  /// Get cached session context
  Future<SessionContext?> getCachedSessionContext(String sessionId) =>
      _getObject(
        '$_cachedSessionContextPrefix$sessionId',
        (j) => SessionContext.fromJson(j),
      );

  // ============================================================
  // Todos/Plan Cache
  // ============================================================

  /// Cache todos for a session
  Future<void> cacheSessionTodos(String sessionId, List<Todo> todos) =>
      _putList('$_cachedTodosPrefix$sessionId', todos, (t) => t.toJson());

  /// Get cached todos for a session
  Future<List<Todo>> getCachedSessionTodos(String sessionId) =>
      _getList('$_cachedTodosPrefix$sessionId', (j) => Todo.fromJson(j));

  // ============================================================
  // VCS/Git Info Cache
  // ============================================================

  /// Cache VCS info for a session
  Future<void> cacheSessionVcs(String sessionId, VcsInfo vcs) =>
      _putObject('$_cachedVcsPrefix$sessionId', vcs, (v) => v.toJson());

  /// Get cached VCS info for a session
  Future<VcsInfo?> getCachedSessionVcs(String sessionId) =>
      _getObject('$_cachedVcsPrefix$sessionId', (j) => VcsInfo.fromJson(j));

  // ============================================================
  // Agents Cache
  // ============================================================

  /// Cache agents list
  Future<void> cacheAgents(List<Agent> agents) =>
      _putList(_cachedAgentsKey, agents, (a) => a.toJson());

  /// Get cached agents
  Future<List<Agent>> getCachedAgents() =>
      _getList(_cachedAgentsKey, (j) => Agent.fromJson(j));

  // ============================================================
  // Commands Cache
  // ============================================================

  /// Cache slash commands list
  Future<void> cacheCommands(List<SlashCommand> commands) =>
      _putList(_cachedCommandsKey, commands, (c) => c.toJson());

  /// Get cached commands
  Future<List<SlashCommand>> getCachedCommands() =>
      _getList(_cachedCommandsKey, (j) => SlashCommand.fromJson(j));

  // ============================================================
  // Tools Cache
  // ============================================================

  /// Cache tools list
  Future<void> cacheTools(List<ToolInfo> tools) =>
      _putList(_cachedToolsKey, tools, _toolInfoToJson);

  /// Get cached tools
  Future<List<ToolInfo>> getCachedTools() =>
      _getList(_cachedToolsKey, (j) => ToolInfo.fromJson(j));

  // ============================================================
  // MCP Servers Cache
  // ============================================================

  /// Cache MCP servers status
  Future<void> cacheMcpServers(Map<String, McpServerStatus> servers) async {
    _memoryCache[_cachedMcpServersKey] = servers;
    _updateCacheTimestamp(_cachedMcpServersKey);

    final jsonMap = <String, dynamic>{};
    for (final entry in servers.entries) {
      jsonMap[entry.key] = _mcpServerToJson(entry.value);
    }
    await _storage.write(key: _cachedMcpServersKey, value: jsonEncode(jsonMap));
  }

  /// Get cached MCP servers
  Future<Map<String, McpServerStatus>> getCachedMcpServers() async {
    final memCached = _memoryCache[_cachedMcpServersKey];
    if (memCached != null && memCached is Map<String, McpServerStatus>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedMcpServersKey);
    if (raw == null) return {};
    try {
      final Map<String, dynamic> jsonMap = jsonDecode(raw);
      final servers = <String, McpServerStatus>{};
      for (final entry in jsonMap.entries) {
        servers[entry.key] = McpServerStatus.fromJson(
          entry.value as Map<String, dynamic>,
        );
      }
      _memoryCache[_cachedMcpServersKey] = servers;
      return servers;
    } catch (_) {
      return {};
    }
  }

  // ============================================================
  // Providers Cache
  // ============================================================

  /// Cache provider info
  Future<void> cacheProviders(ProviderInfo info) =>
      _putObject(_cachedProvidersKey, info, _providerInfoToJson);

  /// Get cached providers
  Future<ProviderInfo?> getCachedProviders() =>
      _getObject(_cachedProvidersKey, (j) => ProviderInfo.fromJson(j));

  /// Cache provider auth methods
  Future<void> cacheProviderAuth(
    Map<String, List<ProviderAuthMethod>> authMethods,
  ) async {
    _memoryCache[_cachedProviderAuthKey] = authMethods;
    _updateCacheTimestamp(_cachedProviderAuthKey);

    final jsonMap = <String, dynamic>{};
    for (final entry in authMethods.entries) {
      jsonMap[entry.key] = entry.value
          .map((m) => _providerAuthToJson(m))
          .toList();
    }
    await _storage.write(
      key: _cachedProviderAuthKey,
      value: jsonEncode(jsonMap),
    );
  }

  /// Get cached provider auth methods
  Future<Map<String, List<ProviderAuthMethod>>> getCachedProviderAuth() async {
    final memCached = _memoryCache[_cachedProviderAuthKey];
    if (memCached != null &&
        memCached is Map<String, List<ProviderAuthMethod>>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedProviderAuthKey);
    if (raw == null) return {};
    try {
      final Map<String, dynamic> jsonMap = jsonDecode(raw);
      final result = <String, List<ProviderAuthMethod>>{};
      for (final entry in jsonMap.entries) {
        final list = (entry.value as List<dynamic>)
            .map(
              (item) =>
                  ProviderAuthMethod.fromJson(item as Map<String, dynamic>),
            )
            .toList();
        result[entry.key] = list;
      }
      _memoryCache[_cachedProviderAuthKey] = result;
      return result;
    } catch (_) {
      return {};
    }
  }

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
  // Pi Sessions Cache
  // ============================================================

  /// Cache Pi sessions list
  Future<void> cachePiSessions(List<PiSessionInfo> sessions) =>
      _putList(_cachedPiSessionsKey, sessions, (s) => s.toJson());

  /// Get cached Pi sessions
  Future<List<PiSessionInfo>> getCachedPiSessions() =>
      _getList(_cachedPiSessionsKey, (j) => PiSessionInfo.fromJson(j));

  // ============================================================
  // Pi Projects Cache
  // ============================================================

  /// Cache Pi projects (derived from Pi session cwd values)
  Future<void> cachePiProjects(List<ProjectSummary> projects) =>
      _putList(_cachedPiProjectsKey, projects, _projectToJson);

  /// Load cached Pi projects
  Future<List<ProjectSummary>> getCachedPiProjects() =>
      _getList(_cachedPiProjectsKey, (j) => ProjectSummary.fromJson(j));

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
  // Codex Threads Cache
  // ============================================================

  /// Cache Codex threads list
  Future<void> cacheCodexThreads(List<CodexThread> threads) =>
      _putList(_cachedCodexThreadsKey, threads, (t) => t.toJson());

  /// Get cached Codex threads
  Future<List<CodexThread>> getCachedCodexThreads() =>
      _getList(_cachedCodexThreadsKey, (j) => CodexThread.fromJson(j));

  /// Cache Codex thread messages (prunes to last 50)
  Future<void> cacheCodexThreadMessages(
    String threadId,
    List<ChatMessage> messages,
  ) async {
    final key = '$_cachedCodexMessagesPrefix$threadId';
    final pruned = messages.length > _maxCachedMessagesPerSession
        ? messages.sublist(messages.length - _maxCachedMessagesPerSession)
        : messages;
    await _putList(key, pruned, _messageToJson);
  }

  /// Get cached Codex thread messages
  Future<List<ChatMessage>> getCachedCodexMessages(String threadId) =>
      _getList('$_cachedCodexMessagesPrefix$threadId', _messageFromJson);

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

  Map<String, dynamic> _toolInfoToJson(ToolInfo t) {
    return {
      'id': t.id,
      'description': t.description,
      'parameters': t.parameters,
    };
  }

  Map<String, dynamic> _mcpServerToJson(McpServerStatus s) {
    return {
      'name': s.name,
      'status': s.status.name,
      'error': s.error,
      'tools': s.tools,
      'resources': s.resources,
    };
  }

  Map<String, dynamic> _sessionContextToJson(SessionContext c) {
    return {
      'tokens': {
        'input': c.tokens.input,
        'output': c.tokens.output,
        'total': c.tokens.total,
        'contextWindow': c.tokens.contextWindow,
      },
      'cost': c.cost,
      if (c.budgetLimitUsd != null) 'budgetLimitUsd': c.budgetLimitUsd,
      'lsp': c.lsp.map((l) => _lspServerToJson(l)).toList(),
      'modifiedFiles': c.modifiedFiles
          .map((f) => _modifiedFileToJson(f))
          .toList(),
    };
  }

  Map<String, dynamic> _lspServerToJson(LspServer l) {
    return {
      'id': l.id,
      'name': l.name,
      'status': l.status.name,
      'language': l.language,
      'root': l.root,
    };
  }

  Map<String, dynamic> _modifiedFileToJson(ModifiedFile f) {
    return {'file': f.file, 'additions': f.additions, 'deletions': f.deletions};
  }

  Map<String, dynamic> _providerInfoToJson(ProviderInfo info) {
    return {
      'all': info.all.map((p) => _providerDetailsToJson(p)).toList(),
      'default': info.defaults,
      'connected': info.connected,
    };
  }

  Map<String, dynamic> _providerDetailsToJson(ProviderDetails p) {
    final modelsMap = <String, dynamic>{};
    for (final entry in p.models.entries) {
      modelsMap[entry.key] = _modelInfoToJson(entry.value);
    }
    return {'id': p.id, 'name': p.name, 'models': modelsMap};
  }

  Map<String, dynamic> _modelInfoToJson(ModelInfo m) {
    return {
      'name': m.name,
      'contextWindow': m.contextWindow,
      'pricing': {'input': m.inputPricing, 'output': m.outputPricing},
    };
  }

  Map<String, dynamic> _providerAuthToJson(ProviderAuthMethod m) {
    return {
      'type': m.type == ProviderAuthType.oauth ? 'oauth' : 'api',
      'name': m.name,
      'description': m.description,
      'url': m.url,
    };
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
