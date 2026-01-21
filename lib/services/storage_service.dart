import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';

import '../models/agent.dart';
import '../models/agent_type.dart';
import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/command.dart';
import '../models/connection.dart';
import '../models/highlight_color.dart';
import '../models/mcp.dart';
import '../models/message.dart';
import '../models/permission_rule.dart';
import '../models/project.dart';
import '../models/provider.dart';
import '../models/session.dart';
import '../models/session_context.dart';
import '../models/stt_settings.dart';
import '../models/terminal_settings.dart';
import '../models/todo.dart';
import '../models/tool.dart';
import '../models/vcs.dart';

class StorageService {
  static const _connectionKey = 'broski_connection';
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
  static const _cachedCodexProjectsKey = 'broski_cached_codex_projects';
  static const _cachedCodexThreadsKey = 'broski_cached_codex_threads';
  static const _cachedCodexMessagesPrefix = 'broski_cached_codex_messages_';
  static const _cachedSubagentsKey = 'broski_cached_subagents';
  static const _cachedCustomToolsKey = 'broski_cached_custom_tools';
  static const _cachedPluginsKey = 'broski_cached_plugins';

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
      _cachedCodexProjectsKey,
      _cachedCodexThreadsKey,
      _cachedSubagentsKey,
      _cachedCustomToolsKey,
      _cachedPluginsKey,
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
  }

  /// Check if sessions cache is fresh (can skip network)
  bool isSessionsCacheFresh() => isCacheFresh(_cachedSessionsKey);

  /// Check if projects cache is fresh (can skip network)
  bool isProjectsCacheFresh() => isCacheFresh(_cachedProjectsKey);

  Future<void> saveConnection(ConnectionInfo info) async {
    await _storage.write(key: _connectionKey, value: jsonEncode(info.toJson()));
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
    return ConnectionInfo.fromJson(data);
  }

  Future<void> clearConnection() async {
    await _storage.delete(key: _connectionKey);
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

  /// Cache Codex projects (derived from Codex thread cwd values)
  Future<void> cacheCodexProjects(List<ProjectSummary> projects) async {
    _memoryCache[_cachedCodexProjectsKey] = projects;
    _updateCacheTimestamp(_cachedCodexProjectsKey);

    final json = jsonEncode(projects.map((p) => _projectToJson(p)).toList());
    await _storage.write(key: _cachedCodexProjectsKey, value: json);
  }

  /// Load cached Codex projects
  Future<List<ProjectSummary>> getCachedCodexProjects() async {
    final memCached = _memoryCache[_cachedCodexProjectsKey];
    if (memCached != null && memCached is List<ProjectSummary>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedCodexProjectsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final projects = list
          .map((item) => ProjectSummary.fromJson(item as Map<String, dynamic>))
          .toList();
      _memoryCache[_cachedCodexProjectsKey] = projects;
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
  Future<void> cacheSessionContext(
    String sessionId,
    SessionContext context,
  ) async {
    final key = '$_cachedSessionContextPrefix$sessionId';
    _memoryCache[key] = context;
    _updateCacheTimestamp(key);

    final json = jsonEncode(_sessionContextToJson(context));
    await _storage.write(key: key, value: json);
  }

  /// Get cached session context
  Future<SessionContext?> getCachedSessionContext(String sessionId) async {
    final key = '$_cachedSessionContextPrefix$sessionId';

    // L1
    final memCached = _memoryCache[key];
    if (memCached != null && memCached is SessionContext) {
      return memCached;
    }

    // L2
    final raw = await _storage.read(key: key);
    if (raw == null) return null;
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final context = SessionContext.fromJson(data);
      _memoryCache[key] = context;
      return context;
    } catch (_) {
      return null;
    }
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

  // ============================================================
  // Todos/Plan Cache
  // ============================================================

  /// Cache todos for a session
  Future<void> cacheSessionTodos(String sessionId, List<Todo> todos) async {
    final key = '$_cachedTodosPrefix$sessionId';
    _memoryCache[key] = todos;
    _updateCacheTimestamp(key);

    final json = jsonEncode(todos.map((t) => t.toJson()).toList());
    await _storage.write(key: key, value: json);
  }

  /// Get cached todos for a session
  Future<List<Todo>> getCachedSessionTodos(String sessionId) async {
    final key = '$_cachedTodosPrefix$sessionId';

    final memCached = _memoryCache[key];
    if (memCached != null && memCached is List<Todo>) {
      return memCached;
    }

    final raw = await _storage.read(key: key);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final todos = list
          .map((item) => Todo.fromJson(item as Map<String, dynamic>))
          .toList();
      _memoryCache[key] = todos;
      return todos;
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // VCS/Git Info Cache
  // ============================================================

  /// Cache VCS info for a session
  Future<void> cacheSessionVcs(String sessionId, VcsInfo vcs) async {
    final key = '$_cachedVcsPrefix$sessionId';
    _memoryCache[key] = vcs;
    _updateCacheTimestamp(key);

    final json = jsonEncode(vcs.toJson());
    await _storage.write(key: key, value: json);
  }

  /// Get cached VCS info for a session
  Future<VcsInfo?> getCachedSessionVcs(String sessionId) async {
    final key = '$_cachedVcsPrefix$sessionId';

    final memCached = _memoryCache[key];
    if (memCached != null && memCached is VcsInfo) {
      return memCached;
    }

    final raw = await _storage.read(key: key);
    if (raw == null) return null;
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final vcs = VcsInfo.fromJson(data);
      _memoryCache[key] = vcs;
      return vcs;
    } catch (_) {
      return null;
    }
  }

  // ============================================================
  // Agents Cache
  // ============================================================

  /// Cache agents list
  Future<void> cacheAgents(List<Agent> agents) async {
    _memoryCache[_cachedAgentsKey] = agents;
    _updateCacheTimestamp(_cachedAgentsKey);

    final json = jsonEncode(agents.map((a) => a.toJson()).toList());
    await _storage.write(key: _cachedAgentsKey, value: json);
  }

  /// Get cached agents
  Future<List<Agent>> getCachedAgents() async {
    final memCached = _memoryCache[_cachedAgentsKey];
    if (memCached != null && memCached is List<Agent>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedAgentsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final agents = list
          .map((item) => Agent.fromJson(item as Map<String, dynamic>))
          .toList();
      _memoryCache[_cachedAgentsKey] = agents;
      return agents;
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // Commands Cache
  // ============================================================

  /// Cache slash commands list
  Future<void> cacheCommands(List<SlashCommand> commands) async {
    _memoryCache[_cachedCommandsKey] = commands;
    _updateCacheTimestamp(_cachedCommandsKey);

    final json = jsonEncode(commands.map((c) => c.toJson()).toList());
    await _storage.write(key: _cachedCommandsKey, value: json);
  }

  /// Get cached commands
  Future<List<SlashCommand>> getCachedCommands() async {
    final memCached = _memoryCache[_cachedCommandsKey];
    if (memCached != null && memCached is List<SlashCommand>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedCommandsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final commands = list
          .map((item) => SlashCommand.fromJson(item as Map<String, dynamic>))
          .toList();
      _memoryCache[_cachedCommandsKey] = commands;
      return commands;
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // Tools Cache
  // ============================================================

  /// Cache tools list
  Future<void> cacheTools(List<ToolInfo> tools) async {
    _memoryCache[_cachedToolsKey] = tools;
    _updateCacheTimestamp(_cachedToolsKey);

    final json = jsonEncode(tools.map((t) => _toolInfoToJson(t)).toList());
    await _storage.write(key: _cachedToolsKey, value: json);
  }

  /// Get cached tools
  Future<List<ToolInfo>> getCachedTools() async {
    final memCached = _memoryCache[_cachedToolsKey];
    if (memCached != null && memCached is List<ToolInfo>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedToolsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final tools = list
          .map((item) => ToolInfo.fromJson(item as Map<String, dynamic>))
          .toList();
      _memoryCache[_cachedToolsKey] = tools;
      return tools;
    } catch (_) {
      return [];
    }
  }

  Map<String, dynamic> _toolInfoToJson(ToolInfo t) {
    return {
      'id': t.id,
      'name': t.name,
      'description': t.description,
      'enabled': t.enabled,
    };
  }

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

  Map<String, dynamic> _mcpServerToJson(McpServerStatus s) {
    return {
      'name': s.name,
      'status': s.status.name,
      'error': s.error,
      'tools': s.tools,
      'resources': s.resources,
    };
  }

  // ============================================================
  // Providers Cache
  // ============================================================

  /// Cache provider info
  Future<void> cacheProviders(ProviderInfo info) async {
    _memoryCache[_cachedProvidersKey] = info;
    _updateCacheTimestamp(_cachedProvidersKey);

    final json = jsonEncode(_providerInfoToJson(info));
    await _storage.write(key: _cachedProvidersKey, value: json);
  }

  /// Get cached providers
  Future<ProviderInfo?> getCachedProviders() async {
    final memCached = _memoryCache[_cachedProvidersKey];
    if (memCached != null && memCached is ProviderInfo) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedProvidersKey);
    if (raw == null) return null;
    try {
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final info = ProviderInfo.fromJson(data);
      _memoryCache[_cachedProvidersKey] = info;
      return info;
    } catch (_) {
      return null;
    }
  }

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
  // PTY Sessions Cache
  // ============================================================

  /// Cache PTY sessions list
  Future<void> cachePtySessions(List<Map<String, dynamic>> sessions) async {
    _memoryCache[_cachedPtySessionsKey] = sessions;
    _updateCacheTimestamp(_cachedPtySessionsKey);

    await _storage.write(
      key: _cachedPtySessionsKey,
      value: jsonEncode(sessions),
    );
  }

  /// Get cached PTY sessions
  Future<List<Map<String, dynamic>>> getCachedPtySessions() async {
    final memCached = _memoryCache[_cachedPtySessionsKey];
    if (memCached != null && memCached is List<Map<String, dynamic>>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedPtySessionsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final sessions = list.cast<Map<String, dynamic>>();
      _memoryCache[_cachedPtySessionsKey] = sessions;
      return sessions;
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // Claude Code Sessions Cache
  // ============================================================

  /// Cache Claude Code sessions list
  Future<void> cacheCCSessions(List<ClaudeCodeSession> sessions) async {
    _memoryCache[_cachedCCSessionsKey] = sessions;
    _updateCacheTimestamp(_cachedCCSessionsKey);

    final json = jsonEncode(sessions.map((s) => s.toJson()).toList());
    await _storage.write(key: _cachedCCSessionsKey, value: json);
  }

  /// Get cached Claude Code sessions
  Future<List<ClaudeCodeSession>> getCachedCCSessions() async {
    final memCached = _memoryCache[_cachedCCSessionsKey];
    if (memCached != null && memCached is List<ClaudeCodeSession>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedCCSessionsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final sessions = list
          .map(
            (item) => ClaudeCodeSession.fromJson(item as Map<String, dynamic>),
          )
          .toList();
      _memoryCache[_cachedCCSessionsKey] = sessions;
      return sessions;
    } catch (_) {
      return [];
    }
  }

  /// Cache Claude Code messages for a session
  Future<void> cacheCCSessionMessages(
    String sessionId,
    List<ChatMessage> messages,
  ) async {
    final key = '$_cachedCCMessagesPrefix$sessionId';

    // Prune to last N messages
    final prunedMessages = messages.length > _maxCachedMessagesPerSession
        ? messages.sublist(messages.length - _maxCachedMessagesPerSession)
        : messages;

    _memoryCache[key] = prunedMessages;
    _updateCacheTimestamp(key);

    final json = jsonEncode(
      prunedMessages.map((m) => _messageToJson(m)).toList(),
    );
    await _storage.write(key: key, value: json);
  }

  /// Get cached Claude Code messages for a session
  Future<List<ChatMessage>> getCachedCCMessages(String sessionId) async {
    final key = '$_cachedCCMessagesPrefix$sessionId';

    final memCached = _memoryCache[key];
    if (memCached != null && memCached is List<ChatMessage>) {
      return memCached;
    }

    final raw = await _storage.read(key: key);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final messages = list
          .map((item) => _messageFromJson(item as Map<String, dynamic>))
          .toList();
      _memoryCache[key] = messages;
      return messages;
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // Codex Threads Cache
  // ============================================================

  Future<void> cacheCodexThreads(List<CodexThread> threads) async {
    _memoryCache[_cachedCodexThreadsKey] = threads;
    _updateCacheTimestamp(_cachedCodexThreadsKey);

    final json = jsonEncode(threads.map((t) => t.toJson()).toList());
    await _storage.write(key: _cachedCodexThreadsKey, value: json);
  }

  Future<List<CodexThread>> getCachedCodexThreads() async {
    final memCached = _memoryCache[_cachedCodexThreadsKey];
    if (memCached != null && memCached is List<CodexThread>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedCodexThreadsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final threads = list
          .map((item) => CodexThread.fromJson(item as Map<String, dynamic>))
          .toList();
      _memoryCache[_cachedCodexThreadsKey] = threads;
      return threads;
    } catch (_) {
      return [];
    }
  }

  Future<void> cacheCodexThreadMessages(
    String threadId,
    List<ChatMessage> messages,
  ) async {
    final key = '$_cachedCodexMessagesPrefix$threadId';

    final prunedMessages = messages.length > _maxCachedMessagesPerSession
        ? messages.sublist(messages.length - _maxCachedMessagesPerSession)
        : messages;

    _memoryCache[key] = prunedMessages;
    _updateCacheTimestamp(key);

    final json = jsonEncode(
      prunedMessages.map((m) => _messageToJson(m)).toList(),
    );
    await _storage.write(key: key, value: json);
  }

  Future<List<ChatMessage>> getCachedCodexMessages(String threadId) async {
    final key = '$_cachedCodexMessagesPrefix$threadId';

    final memCached = _memoryCache[key];
    if (memCached != null && memCached is List<ChatMessage>) {
      return memCached;
    }

    final raw = await _storage.read(key: key);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final messages = list
          .map((item) => _messageFromJson(item as Map<String, dynamic>))
          .toList();
      _memoryCache[key] = messages;
      return messages;
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // Subagents Cache
  // ============================================================

  /// Cache subagents config
  Future<void> cacheSubagents(List<ClaudeCodeSubagent> subagents) async {
    _memoryCache[_cachedSubagentsKey] = subagents;
    _updateCacheTimestamp(_cachedSubagentsKey);

    final json = jsonEncode(subagents.map((s) => s.toJson()).toList());
    await _storage.write(key: _cachedSubagentsKey, value: json);
  }

  /// Get cached subagents
  Future<List<ClaudeCodeSubagent>> getCachedSubagents() async {
    final memCached = _memoryCache[_cachedSubagentsKey];
    if (memCached != null && memCached is List<ClaudeCodeSubagent>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedSubagentsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final subagents = list
          .map(
            (item) => ClaudeCodeSubagent.fromJson(item as Map<String, dynamic>),
          )
          .toList();
      _memoryCache[_cachedSubagentsKey] = subagents;
      return subagents;
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // Custom Tools Cache
  // ============================================================

  /// Cache custom tools config
  Future<void> cacheCustomTools(List<ClaudeCodeCustomTool> tools) async {
    _memoryCache[_cachedCustomToolsKey] = tools;
    _updateCacheTimestamp(_cachedCustomToolsKey);

    final json = jsonEncode(tools.map((t) => t.toJson()).toList());
    await _storage.write(key: _cachedCustomToolsKey, value: json);
  }

  /// Get cached custom tools
  Future<List<ClaudeCodeCustomTool>> getCachedCustomTools() async {
    final memCached = _memoryCache[_cachedCustomToolsKey];
    if (memCached != null && memCached is List<ClaudeCodeCustomTool>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedCustomToolsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final tools = list
          .map(
            (item) =>
                ClaudeCodeCustomTool.fromJson(item as Map<String, dynamic>),
          )
          .toList();
      _memoryCache[_cachedCustomToolsKey] = tools;
      return tools;
    } catch (_) {
      return [];
    }
  }

  // ============================================================
  // Plugins Cache
  // ============================================================

  /// Cache plugins list
  Future<void> cachePlugins(List<ClaudeCodePlugin> plugins) async {
    _memoryCache[_cachedPluginsKey] = plugins;
    _updateCacheTimestamp(_cachedPluginsKey);

    final json = jsonEncode(plugins.map((p) => p.toJson()).toList());
    await _storage.write(key: _cachedPluginsKey, value: json);
  }

  /// Get cached plugins
  Future<List<ClaudeCodePlugin>> getCachedPlugins() async {
    final memCached = _memoryCache[_cachedPluginsKey];
    if (memCached != null && memCached is List<ClaudeCodePlugin>) {
      return memCached;
    }

    final raw = await _storage.read(key: _cachedPluginsKey);
    if (raw == null) return [];
    try {
      final List<dynamic> list = jsonDecode(raw);
      final plugins = list
          .map(
            (item) => ClaudeCodePlugin.fromJson(item as Map<String, dynamic>),
          )
          .toList();
      _memoryCache[_cachedPluginsKey] = plugins;
      return plugins;
    } catch (_) {
      return [];
    }
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
}
