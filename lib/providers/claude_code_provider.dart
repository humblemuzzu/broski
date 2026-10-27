import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/runtime/runtime_event.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_runtime.dart';
import 'package:broski/services/storage_service.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// `null` means "all projects" for Claude Code sessions.
final ccSessionsFilterCwdProvider = StateProvider<String?>((ref) => null);

/// Project list for Claude Code sessions screen (used by "New Session" sheet).
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
    if (projects.isNotEmpty) return projects;
    return await fromCachedSessions();
  } catch (_) {
    return await fromCachedSessions();
  }
});

/// Derived project list for filter sheet — computed directly from loaded
/// CC sessions. Guaranteed: if sessions show in the list, projects show in
/// the filter. No separate API call, no timing issues.
final ccFilterProjectsProvider = Provider<AsyncValue<List<ProjectSummary>>>((
  ref,
) {
  final sessionsAsync = ref.watch(ccSessionsProvider);
  return sessionsAsync.whenData((sessions) {
    final byPath = <String, ProjectSummary>{};
    for (final s in sessions) {
      final path = s.cwd;
      if (path.isEmpty) continue;
      final parts = path.split('/').where((p) => p.isNotEmpty).toList();
      final name = parts.isEmpty ? path : parts.last;
      byPath[path] = ProjectSummary(id: path, name: name, path: path);
    }
    return byPath.values.toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  });
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

final ccSupportedModelsProvider =
    FutureProvider.family<List<ClaudeCodeSupportedModel>, String?>((
      ref,
      cwd,
    ) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.ccGetSupportedModels(cwd: cwd);
    });

final ccAccountInfoProvider =
    FutureProvider.family<ClaudeCodeAccountInfo, String?>((ref, cwd) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.ccGetAccountInfo(cwd: cwd);
    });

final ccMcpServerStatusProvider =
    FutureProvider.family<List<ClaudeCodeMcpServerStatus>, String?>((
      ref,
      cwd,
    ) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.ccGetMcpServerStatus(cwd: cwd);
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

  /// Set the model for Claude Code (null for Default/Recommended)
  Future<void> setModel(String? model) async {
    final current = state.valueOrNull;
    if (current == null) return;

    final updated = model == null
        ? current.copyWith(clearModel: true)
        : current.copyWith(model: model);
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

/// Lightweight display item for CC inline chat — replaces raw
/// [ClaudeCodeStreamMessage] accumulation with a typed display model
/// driven by runtime events.
class CCDisplayItem {
  final String type; // 'text', 'tool', 'error', 'turn_end'
  final String content;
  final String? toolName;
  final dynamic toolInput;
  final String? toolStatus; // 'running', 'completed', 'failed'

  const CCDisplayItem({
    required this.type,
    this.content = '',
    this.toolName,
    this.toolInput,
    this.toolStatus,
  });
}

class CCChatState {
  final String? sessionId;
  final List<CCDisplayItem> displayItems;
  final bool isStreaming;
  final String? error;

  /// True when viewing a session that was not created in this app flow.
  /// Used for clarity in UX around undo/checkpoints.
  final bool isExternal;

  /// Stack of checkpoint UUIDs for file revert (undo) functionality.
  /// Each user message turn creates a checkpoint; we store all of them so
  /// users can undo multiple turns (LIFO order).
  final List<CCCheckpointCreated> checkpoints;

  /// Convenience getter -- the most recent checkpoint (top of the stack).
  CCCheckpointCreated? get latestCheckpoint =>
      checkpoints.isNotEmpty ? checkpoints.last : null;

  /// Whether any checkpoints are available for undo.
  bool get canUndo => checkpoints.isNotEmpty;

  const CCChatState({
    this.sessionId,
    this.displayItems = const [],
    this.isStreaming = false,
    this.error,
    this.checkpoints = const [],
    this.isExternal = false,
  });

  CCChatState copyWith({
    String? sessionId,
    List<CCDisplayItem>? displayItems,
    bool? isStreaming,
    String? error,
    List<CCCheckpointCreated>? checkpoints,
    bool clearCheckpoints = false,
    bool? isExternal,
  }) {
    return CCChatState(
      sessionId: sessionId ?? this.sessionId,
      displayItems: displayItems ?? this.displayItems,
      isStreaming: isStreaming ?? this.isStreaming,
      error: error,
      checkpoints: clearCheckpoints
          ? const []
          : (checkpoints ?? this.checkpoints),
      isExternal: isExternal ?? this.isExternal,
    );
  }
}

final ccChatProvider = StateNotifierProvider<CCChatNotifier, CCChatState>((
  ref,
) {
  final bridge = ref.watch(bridgeServiceProvider);
  return CCChatNotifier(bridge);
});

/// Tracks CC chat state using the unified runtime event stream.
///
/// Replaces the legacy `cc_stream` subscription with runtime events.
/// Tracks checkpoints (for undo), streaming state, errors, and display items
/// for the inline CC chat view.
class CCChatNotifier extends StateNotifier<CCChatState> {
  CCChatNotifier(this._bridge) : super(const CCChatState()) {
    _subscription = _bridge.runtimeEvents
        .where((e) => e.backend == AgentType.claudeCode)
        .listen(_handleRuntimeEvent);
  }

  final BridgeService _bridge;
  StreamSubscription<RuntimeEvent>? _subscription;

  /// Accumulates text deltas during a streaming turn.
  final StringBuffer _textBuffer = StringBuffer();

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

  void _handleRuntimeEvent(RuntimeEvent event) {
    switch (event) {
      case RuntimeAgentStartedEvent():
        _textBuffer.clear();
        state = state.copyWith(
          sessionId: event.sessionId ?? state.sessionId,
          isStreaming: true,
          isExternal: false,
          error: null,
          displayItems: const [], // Clear previous turn's items
        );

      case RuntimeAssistantTextDeltaEvent():
        _textBuffer.write(event.delta);
        // Update the last text display item or add a new one
        final items = List<CCDisplayItem>.from(state.displayItems);
        if (items.isNotEmpty && items.last.type == 'text') {
          items[items.length - 1] = CCDisplayItem(
            type: 'text',
            content: _textBuffer.toString(),
          );
        } else {
          items.add(
            CCDisplayItem(type: 'text', content: _textBuffer.toString()),
          );
        }
        state = state.copyWith(displayItems: items);

      case RuntimeToolStartedEvent():
        final items = List<CCDisplayItem>.from(state.displayItems);
        items.add(
          CCDisplayItem(
            type: 'tool',
            toolName: event.toolName,
            toolInput: event.input,
            toolStatus: 'running',
          ),
        );
        state = state.copyWith(displayItems: items);

      case RuntimeToolFinishedEvent():
        final items = List<CCDisplayItem>.from(state.displayItems);
        // Update the matching tool item status
        for (int i = items.length - 1; i >= 0; i--) {
          if (items[i].type == 'tool' &&
              items[i].toolName == event.toolName &&
              items[i].toolStatus == 'running') {
            items[i] = CCDisplayItem(
              type: 'tool',
              toolName: event.toolName,
              toolInput: event.input,
              toolStatus: (event.isError == true) ? 'failed' : 'completed',
              content: event.output?.toString() ?? '',
            );
            break;
          }
        }
        state = state.copyWith(displayItems: items);

      case RuntimeErrorEvent():
        final items = List<CCDisplayItem>.from(state.displayItems)
          ..add(CCDisplayItem(type: 'error', content: event.message));
        state = state.copyWith(
          isStreaming: false,
          error: event.message,
          displayItems: items,
        );

      case RuntimeAgentFinishedEvent():
        _textBuffer.clear();
        state = state.copyWith(isStreaming: false);

      case RuntimeBackendEvent():
        if (event.kind == 'checkpoint-created') {
          final payload = event.payload;
          if (payload is Map<String, dynamic>) {
            final checkpoint = CCCheckpointCreated.fromJson(payload);
            if (checkpoint.sessionId == state.sessionId) {
              state = state.copyWith(
                checkpoints: [...state.checkpoints, checkpoint],
              );
            }
          }
        } else if (event.kind == 'token-usage') {
          // Token usage signals turn end
          state = state.copyWith(isStreaming: false);
        }

      default:
        break;
    }
  }

  void clearMessages() {
    _textBuffer.clear();
    state = const CCChatState();
  }

  void setSession(String sessionId) {
    _textBuffer.clear();
    // Clear checkpoint when switching sessions - it's session-specific
    state = CCChatState(sessionId: sessionId, isExternal: true);
  }

  /// Rewind files to the latest checkpoint (undo the last turn's file changes).
  /// Pops the most recent checkpoint from the stack so subsequent undos
  /// rewind further back in history.
  /// Returns true if successful, false otherwise.
  Future<bool> rewindToCheckpoint({required String cwd}) async {
    if (state.checkpoints.isEmpty || state.sessionId == null) {
      return false;
    }

    final sessionId = state.sessionId!;
    final checkpoints = List<CCCheckpointCreated>.from(state.checkpoints);
    final checkpoint = checkpoints.removeLast();

    final success = await _bridge.ccRewindCheckpoint(
      sessionId: sessionId,
      checkpointUuid: checkpoint.checkpointUuid,
      cwd: cwd,
    );

    if (success) {
      // Pop the used checkpoint; older checkpoints remain for further undos.
      state = state.copyWith(checkpoints: checkpoints);
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
      return CustomToolTestResult(success: false, error: humanizeError(e));
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

/// How much of a session the prefetch asks for.
const int _ccPrefetchMessages = 20;

/// Prefetch messages for the top N Claude Code sessions to speed up opening.
void prefetchTopCCSessions(
  WidgetRef ref,
  List<ClaudeCodeSession> sessions, {
  int count = 3,
}) {
  final bridge = ref.read(bridgeServiceProvider);
  for (final session in sessions.take(count)) {
    // Fire and forget — just warm the cache, one screenful of it
    bridge
        .ccGetSessionMessages(
          session.id,
          cwd: session.cwd,
          limit: _ccPrefetchMessages,
        )
        .catchError((_) => <Map<String, dynamic>>[]);
  }
}
