import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../models/project.dart';
import '../services/bridge_service.dart';
import '../services/storage_service.dart';
import 'connection_provider.dart';
import 'service_providers.dart';

/// `null` means "all projects" for Claude Code sessions.
final ccSessionsFilterCwdProvider = StateProvider<String?>((ref) => null);

/// Project list for Claude Code sessions screen.
/// Online: uses `cc_list_projects` (derived from ~/.claude/projects).
/// Offline: derives projects from cached CC sessions.
final ccProjectsForSessionsProvider = FutureProvider<List<ProjectSummary>>((
  ref,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  final storage = ref.watch(storageServiceProvider);
  final connection = ref.read(connectionProvider);

  Future<List<ProjectSummary>> fromCachedSessions() async {
    final cached = await storage.getCachedCCSessions();
    final byPath = <String, ProjectSummary>{};
    for (final s in cached) {
      final path = s.cwd;
      if (path.isEmpty) continue;
      final parts = path.split('/').where((p) => p.isNotEmpty).toList();
      final name = parts.isEmpty ? path : parts.last;
      byPath[path] = ProjectSummary(id: path, name: name, path: path);
    }
    final projects = byPath.values.toList();
    projects.sort(
      (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
    );
    return projects;
  }

  if (connection.isOfflineMode) {
    return await fromCachedSessions();
  }

  try {
    final projects = await bridge.ccListProjects();
    return projects;
  } catch (_) {
    return await fromCachedSessions();
  }
});

final ccSessionsProvider =
    StateNotifierProvider<
      CCSessionsNotifier,
      AsyncValue<List<ClaudeCodeSession>>
    >((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      final storage = ref.watch(storageServiceProvider);
      // Use ref.read() to avoid rebuilding provider on every connection state change
      final connection = ref.read(connectionProvider);
      return CCSessionsNotifier(bridge, storage, connection);
    });

class CCSessionsNotifier
    extends StateNotifier<AsyncValue<List<ClaudeCodeSession>>> {
  CCSessionsNotifier(this._bridge, this._storage, this._connection)
    : super(const AsyncValue.loading());

  final BridgeService _bridge;
  final StorageService _storage;
  final BridgeConnectionState _connection;

  Future<void> load({String? cwd}) async {
    // Offline mode - use cached sessions
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedCCSessions();
      state = AsyncValue.data(cached);
      return;
    }

    state = const AsyncValue.loading();
    try {
      final sessions = await _bridge.ccListSessions(cwd: cwd);
      // Cache for offline use
      if (sessions.isNotEmpty) {
        await _storage.cacheCCSessions(sessions);
      }
      state = AsyncValue.data(sessions);
    } catch (e, st) {
      // On error, try cached data
      final cached = await _storage.getCachedCCSessions();
      if (cached.isNotEmpty) {
        state = AsyncValue.data(cached);
      } else {
        state = AsyncValue.error(e, st);
      }
    }
  }

  Future<void> refresh({String? cwd}) async {
    // Offline mode - just use cached
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedCCSessions();
      state = AsyncValue.data(cached);
      return;
    }

    try {
      final sessions = await _bridge.ccListSessions(cwd: cwd);
      // Cache for offline use
      if (sessions.isNotEmpty) {
        await _storage.cacheCCSessions(sessions);
      }
      state = AsyncValue.data(sessions);
    } catch (e, st) {
      // On error, keep current data or use cached
      final cached = await _storage.getCachedCCSessions();
      if (cached.isNotEmpty && !state.hasValue) {
        state = AsyncValue.data(cached);
      } else if (!state.hasValue) {
        state = AsyncValue.error(e, st);
      }
    }
  }

  Future<bool> deleteSession(String sessionId, {String? cwd}) async {
    try {
      final deleted = await _bridge.ccDeleteSession(sessionId, cwd: cwd);
      if (deleted) {
        state = state.whenData(
          (sessions) => sessions.where((s) => s.id != sessionId).toList(),
        );
      }
      return deleted;
    } catch (_) {
      return false;
    }
  }
}

final ccSkillsProvider = FutureProvider.family<List<ClaudeCodeSkill>, String?>((
  ref,
  cwd,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.ccListSkills(cwd: cwd);
});

final ccHooksProvider = FutureProvider.family<List<ClaudeCodeHook>, String?>((
  ref,
  cwd,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.ccListHooks(cwd: cwd);
});

final ccCommandsProvider =
    FutureProvider.family<List<ClaudeCodeCommand>, String?>((ref, cwd) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.ccListCommands(cwd: cwd);
    });

final ccConfigProvider =
    StateNotifierProvider<CCConfigNotifier, AsyncValue<ClaudeCodeConfig>>((
      ref,
    ) {
      final bridge = ref.watch(bridgeServiceProvider);
      final storage = ref.watch(storageServiceProvider);
      // Use ref.read() to avoid rebuilding provider on every connection state change
      final connection = ref.read(connectionProvider);
      return CCConfigNotifier(bridge, storage, connection);
    });

class CCConfigNotifier extends StateNotifier<AsyncValue<ClaudeCodeConfig>> {
  CCConfigNotifier(this._bridge, this._storage, this._connection)
    : super(const AsyncValue.loading());

  final BridgeService _bridge;
  final StorageService _storage;
  final BridgeConnectionState _connection;

  Future<void> load() async {
    // Offline mode - use cached subagents
    if (_connection.isOfflineMode) {
      final cachedSubagents = await _storage.getCachedSubagents();
      // Return a default config with cached subagents
      state = AsyncValue.data(
        ClaudeCodeConfig(
          permissionMode: ClaudeCodePermissionMode.defaultMode,
          allowedTools: const [],
          disallowedTools: const [],
          systemPrompt: const ClaudeCodeSystemPrompt(preset: 'claude_code'),
          subagents: cachedSubagents,
        ),
      );
      return;
    }

    state = const AsyncValue.loading();
    try {
      final config = await _bridge.ccGetConfig();
      // Cache subagents for offline use
      if (config.subagents.isNotEmpty) {
        await _storage.cacheSubagents(config.subagents);
      }
      state = AsyncValue.data(config);
    } catch (e, st) {
      // Try cached subagents on error
      final cachedSubagents = await _storage.getCachedSubagents();
      if (cachedSubagents.isNotEmpty) {
        state = AsyncValue.data(
          ClaudeCodeConfig(
            permissionMode: ClaudeCodePermissionMode.defaultMode,
            allowedTools: const [],
            disallowedTools: const [],
            systemPrompt: const ClaudeCodeSystemPrompt(preset: 'claude_code'),
            subagents: cachedSubagents,
          ),
        );
      } else {
        state = AsyncValue.error(e, st);
      }
    }
  }

  Future<void> updateConfig(ClaudeCodeConfig config) async {
    try {
      final updated = await _bridge.ccSetConfig(config);
      state = AsyncValue.data(updated);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// Set the model for Claude Code (null for Auto)
  Future<void> setModel(String? model) async {
    final current = state.valueOrNull;
    if (current == null) return;

    final updated = current.copyWith(model: model);
    await updateConfig(updated);
  }

  /// Set the permission mode for Claude Code
  Future<void> setPermissionMode(ClaudeCodePermissionMode mode) async {
    final current = state.valueOrNull;
    if (current == null) return;

    final updated = current.copyWith(permissionMode: mode);
    await updateConfig(updated);
  }

  // ==========================================================================
  // SUBAGENT MANAGEMENT
  // ==========================================================================

  /// Get all configured subagents
  List<ClaudeCodeSubagent> get subagents => state.valueOrNull?.subagents ?? [];

  /// Get the currently active subagent name (null = no subagent selected)
  String? get activeSubagent => state.valueOrNull?.activeSubagent;

  /// Set the active subagent by name (null to clear selection)
  Future<void> setActiveSubagent(String? name) async {
    final current = state.valueOrNull;
    if (current == null) return;

    final updated = current.copyWith(activeSubagent: name);
    await updateConfig(updated);
  }

  /// Add a new subagent
  Future<void> addSubagent(ClaudeCodeSubagent subagent) async {
    final current = state.valueOrNull;
    if (current == null) return;

    // Check for duplicate name
    final existing = current.subagents.where((s) => s.name == subagent.name);
    if (existing.isNotEmpty) {
      throw ArgumentError(
        'Subagent with name "${subagent.name}" already exists',
      );
    }

    final updated = current.copyWith(
      subagents: [...current.subagents, subagent],
    );
    await updateConfig(updated);
  }

  /// Update an existing subagent (by name)
  Future<void> updateSubagent(ClaudeCodeSubagent subagent) async {
    final current = state.valueOrNull;
    if (current == null) return;

    final index = current.subagents.indexWhere((s) => s.name == subagent.name);
    if (index == -1) {
      throw ArgumentError('Subagent with name "${subagent.name}" not found');
    }

    final newList = List<ClaudeCodeSubagent>.from(current.subagents);
    newList[index] = subagent;

    final updated = current.copyWith(subagents: newList);
    await updateConfig(updated);
  }

  /// Delete a subagent by name
  Future<void> deleteSubagent(String name) async {
    final current = state.valueOrNull;
    if (current == null) return;

    final newList = current.subagents.where((s) => s.name != name).toList();

    // Clear active subagent if we're deleting it
    final activeSubagent = current.activeSubagent == name
        ? null
        : current.activeSubagent;

    final updated = current.copyWith(
      subagents: newList,
      activeSubagent: activeSubagent,
    );
    await updateConfig(updated);
  }
}

class CCChatState {
  final String? sessionId;
  final List<ClaudeCodeStreamMessage> messages;
  final bool isStreaming;
  final String? error;

  /// The most recent checkpoint UUID for file revert (undo) functionality.
  /// Updated whenever we receive a checkpoint-created event from the SDK.
  final CCCheckpointCreated? latestCheckpoint;

  const CCChatState({
    this.sessionId,
    this.messages = const [],
    this.isStreaming = false,
    this.error,
    this.latestCheckpoint,
  });

  CCChatState copyWith({
    String? sessionId,
    List<ClaudeCodeStreamMessage>? messages,
    bool? isStreaming,
    String? error,
    CCCheckpointCreated? latestCheckpoint,
    bool clearCheckpoint = false,
  }) {
    return CCChatState(
      sessionId: sessionId ?? this.sessionId,
      messages: messages ?? this.messages,
      isStreaming: isStreaming ?? this.isStreaming,
      error: error,
      latestCheckpoint: clearCheckpoint
          ? null
          : (latestCheckpoint ?? this.latestCheckpoint),
    );
  }
}

final ccChatProvider = StateNotifierProvider<CCChatNotifier, CCChatState>((
  ref,
) {
  final bridge = ref.watch(bridgeServiceProvider);
  return CCChatNotifier(bridge);
});

class CCChatNotifier extends StateNotifier<CCChatState> {
  CCChatNotifier(this._bridge) : super(const CCChatState()) {
    _subscription = _bridge.ccStreamMessages.listen(_handleStreamMessage);
  }

  final BridgeService _bridge;
  StreamSubscription<ClaudeCodeStreamMessage>? _subscription;

  void sendMessage({
    required String sessionId,
    required String prompt,
    String? cwd,
    String? model,
    ClaudeCodePermissionMode? permissionMode,
    String? activeSubagent,
  }) {
    state = state.copyWith(
      sessionId: sessionId,
      isStreaming: true,
      error: null,
    );

    _bridge.ccChat(
      sessionId: sessionId,
      prompt: prompt,
      cwd: cwd,
      model: model,
      permissionMode: permissionMode,
      activeSubagent: activeSubagent,
    );
  }

  void abort() {
    if (state.sessionId != null) {
      _bridge.ccAbort(state.sessionId!);
      state = state.copyWith(isStreaming: false);
    }
  }

  void _handleStreamMessage(ClaudeCodeStreamMessage message) {
    if (message is CCSessionCreated) {
      state = state.copyWith(sessionId: message.sessionId);
    } else if (message is CCError) {
      state = state.copyWith(isStreaming: false, error: message.message);
    } else if (message is CCCheckpointCreated) {
      // Track the latest checkpoint for undo/revert functionality.
      // Only track if it matches the current session.
      if (message.sessionId == state.sessionId) {
        state = state.copyWith(latestCheckpoint: message);
      }
    }

    state = state.copyWith(messages: [...state.messages, message]);

    if (message is CCTokenUsage) {
      state = state.copyWith(isStreaming: false);
    }
  }

  void clearMessages() {
    state = const CCChatState();
  }

  void setSession(String sessionId) {
    // Clear checkpoint when switching sessions - it's session-specific
    state = CCChatState(sessionId: sessionId);
  }

  /// Rewind files to the latest checkpoint (undo file changes).
  /// Returns true if successful, false otherwise.
  Future<bool> rewindToCheckpoint({required String cwd}) async {
    final checkpoint = state.latestCheckpoint;
    final sessionId = state.sessionId;

    if (checkpoint == null || sessionId == null) {
      return false;
    }

    final success = await _bridge.ccRewindCheckpoint(
      sessionId: sessionId,
      checkpointUuid: checkpoint.checkpointUuid,
      cwd: cwd,
    );

    if (success) {
      // Clear the checkpoint after successful rewind.
      // The SDK will create a new checkpoint on the next file operation.
      state = state.copyWith(clearCheckpoint: true);
    }

    return success;
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }
}

// =============================================================================
// CUSTOM TOOLS PROVIDER
// =============================================================================

final ccCustomToolsProvider =
    StateNotifierProvider<
      CCCustomToolsNotifier,
      AsyncValue<List<ClaudeCodeCustomTool>>
    >((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      final storage = ref.watch(storageServiceProvider);
      // Use ref.read() to avoid rebuilding provider on every connection state change
      final connection = ref.read(connectionProvider);
      return CCCustomToolsNotifier(bridge, storage, connection);
    });

class CCCustomToolsNotifier
    extends StateNotifier<AsyncValue<List<ClaudeCodeCustomTool>>> {
  CCCustomToolsNotifier(this._bridge, this._storage, this._connection)
    : super(const AsyncValue.loading());

  final BridgeService _bridge;
  final StorageService _storage;
  final BridgeConnectionState _connection;

  /// Load all custom tools
  Future<void> load() async {
    // Offline mode - use cached
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedCustomTools();
      state = AsyncValue.data(cached);
      return;
    }

    state = const AsyncValue.loading();
    try {
      final tools = await _bridge.ccListCustomTools();
      // Cache for offline
      if (tools.isNotEmpty) {
        await _storage.cacheCustomTools(tools);
      }
      state = AsyncValue.data(tools);
    } catch (e, st) {
      // Try cached on error
      final cached = await _storage.getCachedCustomTools();
      if (cached.isNotEmpty) {
        state = AsyncValue.data(cached);
      } else {
        state = AsyncValue.error(e, st);
      }
    }
  }

  /// Refresh the custom tools list
  Future<void> refresh() async {
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedCustomTools();
      state = AsyncValue.data(cached);
      return;
    }

    try {
      final tools = await _bridge.ccListCustomTools();
      if (tools.isNotEmpty) {
        await _storage.cacheCustomTools(tools);
      }
      state = AsyncValue.data(tools);
    } catch (e, st) {
      final cached = await _storage.getCachedCustomTools();
      if (cached.isNotEmpty && !state.hasValue) {
        state = AsyncValue.data(cached);
      } else if (!state.hasValue) {
        state = AsyncValue.error(e, st);
      }
    }
  }

  /// Get all custom tools (loaded)
  List<ClaudeCodeCustomTool> get tools => state.valueOrNull ?? [];

  /// Get enabled custom tools only
  List<ClaudeCodeCustomTool> get enabledTools =>
      tools.where((t) => t.enabled).toList();

  /// Save a custom tool (create or update)
  Future<ClaudeCodeCustomTool?> saveTool(ClaudeCodeCustomTool tool) async {
    try {
      final saved = await _bridge.ccSaveCustomTool(tool);
      if (saved != null) {
        // Update local state
        final current = state.valueOrNull ?? [];
        final index = current.indexWhere((t) => t.id == saved.id);
        if (index >= 0) {
          final newList = List<ClaudeCodeCustomTool>.from(current);
          newList[index] = saved;
          state = AsyncValue.data(newList);
        } else {
          state = AsyncValue.data([...current, saved]);
        }
      }
      return saved;
    } catch (e, st) {
      state = AsyncValue.error(e, st);
      return null;
    }
  }

  /// Delete a custom tool
  Future<bool> deleteTool(String id) async {
    try {
      final deleted = await _bridge.ccDeleteCustomTool(id);
      if (deleted) {
        final current = state.valueOrNull ?? [];
        state = AsyncValue.data(current.where((t) => t.id != id).toList());
      }
      return deleted;
    } catch (_) {
      return false;
    }
  }

  /// Toggle a tool's enabled state
  Future<bool> toggleTool(String id, bool enabled) async {
    final current = state.valueOrNull ?? [];
    final tool = current.firstWhere(
      (t) => t.id == id,
      orElse: () => throw ArgumentError('Tool not found: $id'),
    );

    final updated = tool.copyWith(enabled: enabled);
    final saved = await saveTool(updated);
    return saved != null;
  }

  /// Test a custom tool with sample arguments
  Future<CustomToolTestResult> testTool(
    ClaudeCodeCustomTool tool,
    Map<String, dynamic> testArgs,
  ) async {
    try {
      return await _bridge.ccTestCustomTool(tool, testArgs);
    } catch (e) {
      return CustomToolTestResult(success: false, error: e.toString());
    }
  }

  /// Get the MCP tool names for all enabled custom tools
  /// These are the names that will appear in the Claude Code tools list
  List<String> get enabledToolMcpNames =>
      enabledTools.map((t) => t.mcpToolName).toList();
}

// =============================================================================
// PLUGINS PROVIDER
// =============================================================================

final ccPluginsProvider =
    StateNotifierProvider<
      CCPluginsNotifier,
      AsyncValue<List<ClaudeCodePlugin>>
    >((ref) {
      final bridge = ref.watch(bridgeServiceProvider);
      final storage = ref.watch(storageServiceProvider);
      // Use ref.read() to avoid rebuilding provider on every connection state change
      final connection = ref.read(connectionProvider);
      return CCPluginsNotifier(bridge, storage, connection);
    });

class CCPluginsNotifier
    extends StateNotifier<AsyncValue<List<ClaudeCodePlugin>>> {
  CCPluginsNotifier(this._bridge, this._storage, this._connection)
    : super(const AsyncValue.loading());

  final BridgeService _bridge;
  final StorageService _storage;
  final BridgeConnectionState _connection;

  /// Load all plugins
  Future<void> load({String? cwd}) async {
    // Offline mode - use cached
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedPlugins();
      state = AsyncValue.data(cached);
      return;
    }

    state = const AsyncValue.loading();
    try {
      final plugins = await _bridge.ccListPlugins(cwd: cwd);
      // Cache for offline
      if (plugins.isNotEmpty) {
        await _storage.cachePlugins(plugins);
      }
      state = AsyncValue.data(plugins);
    } catch (e, st) {
      // Try cached on error
      final cached = await _storage.getCachedPlugins();
      if (cached.isNotEmpty) {
        state = AsyncValue.data(cached);
      } else {
        state = AsyncValue.error(e, st);
      }
    }
  }

  /// Refresh the plugin list
  Future<void> refresh({String? cwd}) async {
    if (_connection.isOfflineMode) {
      final cached = await _storage.getCachedPlugins();
      state = AsyncValue.data(cached);
      return;
    }

    try {
      final plugins = await _bridge.ccListPlugins(cwd: cwd);
      if (plugins.isNotEmpty) {
        await _storage.cachePlugins(plugins);
      }
      state = AsyncValue.data(plugins);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// Get all plugins (loaded)
  List<ClaudeCodePlugin> get plugins => state.valueOrNull ?? [];

  /// Get enabled plugins only
  List<ClaudeCodePlugin> get enabledPlugins =>
      plugins.where((p) => p.status == ClaudeCodePluginStatus.enabled).toList();

  /// Get disabled plugins only
  List<ClaudeCodePlugin> get disabledPlugins => plugins
      .where((p) => p.status == ClaudeCodePluginStatus.disabled)
      .toList();

  /// Toggle a plugin's enabled/disabled state
  Future<bool> togglePlugin(String name, {required bool enabled}) async {
    try {
      final success = await _bridge.ccTogglePlugin(name, enabled: enabled);
      if (success) {
        // Update local state
        final current = state.valueOrNull ?? [];
        final index = current.indexWhere((p) => p.name == name);
        if (index >= 0) {
          final newList = List<ClaudeCodePlugin>.from(current);
          newList[index] = current[index].copyWith(
            status: enabled
                ? ClaudeCodePluginStatus.enabled
                : ClaudeCodePluginStatus.disabled,
          );
          state = AsyncValue.data(newList);
        }
      }
      return success;
    } catch (_) {
      return false;
    }
  }

  /// Add a custom plugin path
  Future<bool> addPluginPath(String path) async {
    try {
      final success = await _bridge.ccAddPluginPath(path);
      if (success) {
        // Reload to get the new plugin
        await refresh();
      }
      return success;
    } catch (_) {
      return false;
    }
  }

  /// Remove a custom plugin path
  Future<bool> removePluginPath(String path) async {
    try {
      final success = await _bridge.ccRemovePluginPath(path);
      if (success) {
        // Reload to reflect removal
        await refresh();
      }
      return success;
    } catch (_) {
      return false;
    }
  }

  /// Force reload plugins (clear cache and re-discover)
  Future<void> reload({String? cwd}) async {
    state = const AsyncValue.loading();
    try {
      final plugins = await _bridge.ccReloadPlugins(cwd: cwd);
      state = AsyncValue.data(plugins);
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }
}

/// Provider for plugin configuration
final ccPluginConfigProvider = FutureProvider<ClaudeCodePluginConfig>((
  ref,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.ccGetPluginConfig();
});
