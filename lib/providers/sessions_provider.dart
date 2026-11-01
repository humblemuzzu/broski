import 'dart:async';
import 'dart:developer' as developer;

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/models/session.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/notifications/chat_presence.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/sessions/runtime_session_activity_handler.dart';
import 'package:broski/providers/sessions/runtime_session_delta_handler.dart';
import 'package:broski/providers/sessions/runtime_session_snapshot_handler.dart';
import 'package:broski/services/bridge/bridge_runtime.dart';
import 'package:broski/services/notification_service.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// ============================================================
// Global Session Status Provider
// ============================================================
// Tracks busy/idle/retry status for ALL sessions, not just the active one.
// This enables showing "Active" indicators on session cards in the list.

/// Global session status map: sessionId -> SessionStatus
/// Uses StateNotifierProvider for real-time SSE updates.
final globalSessionStatusProvider =
    StateNotifierProvider<
      GlobalSessionStatusNotifier,
      Map<String, SessionStatus>
    >((ref) => GlobalSessionStatusNotifier(ref));

/// Tracks session activity for notifications (start time, last tool)
class _SessionActivity {
  final DateTime startedAt;
  String? lastToolName;

  _SessionActivity({required this.startedAt});
}

class GlobalSessionStatusNotifier
    extends StateNotifier<Map<String, SessionStatus>> {
  GlobalSessionStatusNotifier(this._ref) : super({}) {
    _init();
  }

  final Ref _ref;

  /// Tracks when sessions became busy and last tool used
  final Map<String, _SessionActivity> _sessionActivity = {};

  StreamSubscription<RuntimeEvent>? _runtimeEventSubscription;
  StreamSubscription<RuntimeState>? _runtimeStateSubscription;
  StreamSubscription<Map<String, dynamic>>? _sessionDeltaSubscription;

  void _init() {
    final bridge = _ref.read(bridgeServiceProvider);
    _runtimeEventSubscription = bridge.runtimeEvents.listen(
      _handleRuntimeEvent,
    );
    _runtimeStateSubscription = bridge.runtimeStates.listen(
      _handleRuntimeState,
    );
    _sessionDeltaSubscription = bridge.messages.listen(_handleSessionDelta);
  }

  void _handleRuntimeEvent(RuntimeEvent event) {
    final sessionId = runtimeSessionIdFromEvent(event);
    if (sessionId == null || sessionId.isEmpty) return;

    final status = runtimeSessionStatusFromEvent(event);
    if (status != null) {
      _applyRuntimeStatus(sessionId, status);
    }

    final toolName = runtimeToolNameFromEvent(event);
    if (toolName != null && _sessionActivity.containsKey(sessionId)) {
      _sessionActivity[sessionId]!.lastToolName = toolName;
    }
  }

  void _handleRuntimeState(RuntimeState runtimeState) {
    final sessionId = (runtimeState.sessionId ?? '').trim();
    if (sessionId.isEmpty) return;
    _applyRuntimeStatus(sessionId, runtimeSessionStatusFromState(runtimeState));
  }

  /// The bridge sends the one row that changed; the list providers apply it themselves.
  void _handleSessionDelta(Map<String, dynamic> message) {
    switch (runtimeSessionDeltaFromMessage(message)) {
      case RuntimeSessionUpserted(:final session):
        final status = runtimeSessionStatusFromSummary(session);
        if (status != null) _applyRuntimeStatus(session.id, status);
      case RuntimeSessionRemoved(:final sessionId):
        final next = {...state}..remove(sessionId);
        state = next;
      case null:
        break;
    }
  }

  void _applyRuntimeStatus(String sessionId, SessionStatus status) {
    final previousStatus = state[sessionId];
    final wasBusy =
        previousStatus != null &&
        (previousStatus.isBusy || previousStatus.isRetry);

    if (!wasBusy && (status.isBusy || status.isRetry)) {
      _sessionActivity[sessionId] = _SessionActivity(startedAt: DateTime.now());
    }

    if (wasBusy && status.isIdle) {
      final activity = _sessionActivity.remove(sessionId);
      final duration = activity == null
          ? null
          : DateTime.now().difference(activity.startedAt);
      final lastTool = activity?.lastToolName;

      state = {...state, sessionId: status};
      if (shouldNotifyForFinishedSession(_ref, sessionId)) {
        _showCompletionNotification(
          sessionId,
          duration: duration,
          lastTool: lastTool,
        );
      }
      return;
    }

    state = {...state, sessionId: status};
    if (status.isIdle) {
      _sessionActivity.remove(sessionId);
    }
  }

  /// Show notification when a session completes
  void _showCompletionNotification(
    String sessionId, {
    Duration? duration,
    String? lastTool,
  }) {
    // Session info from the cached session list, when it has this session.
    _ref.read(storageServiceProvider).getCachedCCSessions().then((ccSessions) {
      final ccSession = ccSessions.where((s) => s.id == sessionId).firstOrNull;
      if (ccSession != null) {
        final title = ccSession.displayTitle;
        final cwd = ccSession.cwd;
        final project = cwd.split('/').where((p) => p.isNotEmpty).lastOrNull;

        NotificationService.instance.showSessionCompleted(
          sessionId: sessionId,
          title: title,
          projectName: project ?? 'Claude Code',
          duration: duration,
          lastTool: lastTool,
        );
        return;
      }

      // Final fallback
      NotificationService.instance.showSessionCompleted(
        sessionId: sessionId,
        title: 'Session',
        projectName: 'Unknown',
        duration: duration,
        lastTool: lastTool,
      );
    });
  }

  /// Fetch initial statuses for all sessions from bridge
  Future<void> fetchAllStatuses() async {
    final connection = _ref.read(connectionProvider);
    if (connection.isOfflineMode) return;

    try {
      final bridge = _ref.read(bridgeServiceProvider);
      final statuses = <String, SessionStatus>{};
      final ccActive = await bridge.ccGetActiveSessions();
      for (final item in ccActive) {
        final sessionId = item['sessionId'] as String? ?? '';
        if (sessionId.isEmpty) continue;
        statuses[sessionId] = const SessionStatus.busy();
      }

      if (kDebugMode) {
        developer.log(
          'Fetched ${statuses.length} session statuses: ${statuses.entries.where((e) => !e.value.isIdle).map((e) => "${e.key}: ${e.value.displayString}").join(", ")}',
          name: 'GlobalSessionStatus',
        );
      }

      state = {...state, ...statuses};
    } catch (e) {
      if (kDebugMode) {
        developer.log(
          'Failed to fetch session statuses: $e',
          name: 'GlobalSessionStatus',
        );
      }
    }
  }

  /// Update status for a specific session
  void updateStatus(String sessionId, SessionStatus status) {
    state = {...state, sessionId: status};
  }

  @override
  void dispose() {
    _runtimeEventSubscription?.cancel();
    _runtimeStateSubscription?.cancel();
    _sessionDeltaSubscription?.cancel();
    super.dispose();
  }
}

/// Per-project session display limit.
/// Default: show 5 sessions per project group, "Load more" expands.
const int kSessionsPerProjectDefault = 5;

class _ProjectExpandedNotifier extends StateNotifier<Set<String>> {
  _ProjectExpandedNotifier() : super({});

  void expand(String directory) {
    state = {...state, directory};
  }

  void collapse(String directory) {
    state = {...state}..remove(directory);
  }

  void toggle(String directory) {
    if (state.contains(directory)) {
      collapse(directory);
    } else {
      expand(directory);
    }
  }

  bool isExpanded(String directory) => state.contains(directory);

  void reset() => state = {};
}

/// Per-agent project expansion tracking (so expanding in one tab does not affect others).
final ccProjectExpandedProvider =
    StateNotifierProvider<_ProjectExpandedNotifier, Set<String>>((ref) {
      return _ProjectExpandedNotifier();
    });

final piProjectExpandedProvider =
    StateNotifierProvider<_ProjectExpandedNotifier, Set<String>>((ref) {
      return _ProjectExpandedNotifier();
    });

// ============================================================
// Sessions Title Filters (hide sessions by title)
// ============================================================

bool sessionTitleMatchesExcludeFilters(String title, List<String> filters) {
  if (filters.isEmpty) return false;
  final t = title.trim();
  if (t.isEmpty) return false;

  for (final raw in filters) {
    final f = raw.trim();
    if (f.isEmpty) continue;

    // Regex syntax: /pattern/ (case-insensitive)
    if (f.length >= 3 && f.startsWith('/') && f.endsWith('/')) {
      final pattern = f.substring(1, f.length - 1);
      try {
        final re = RegExp(pattern, caseSensitive: false);
        if (re.hasMatch(t)) return true;
      } catch (_) {
        // Invalid regex -> ignore
      }
      continue;
    }

    // Default: case-insensitive substring match
    if (t.toLowerCase().contains(f.toLowerCase())) {
      return true;
    }
  }

  return false;
}

final sessionsTitleExcludeFiltersProvider =
    StateNotifierProvider.family<
      SessionsTitleExcludeFiltersNotifier,
      List<String>,
      AgentType
    >((ref, agentType) {
      final storage = ref.watch(storageServiceProvider);
      return SessionsTitleExcludeFiltersNotifier(storage, agentType)..load();
    });

class SessionsTitleExcludeFiltersNotifier extends StateNotifier<List<String>> {
  SessionsTitleExcludeFiltersNotifier(this._storage, this._agentType)
    : super(const []);

  final StorageService _storage;
  final AgentType _agentType;

  Future<void> load() async {
    final filters = await _storage.getSessionsTitleExcludeFiltersForAgent(
      _agentType,
    );
    state = filters;
  }

  Future<void> setAll(List<String> filters) async {
    final normalized = filters
        .map((f) => f.trim())
        .where((f) => f.isNotEmpty)
        .toList();
    state = normalized;
    await _storage.setSessionsTitleExcludeFiltersForAgent(
      _agentType,
      normalized,
    );
  }

  Future<void> add(String filter) async {
    final f = filter.trim();
    if (f.isEmpty) return;
    if (state.contains(f)) return;
    await setAll([...state, f]);
  }

  Future<void> removeAt(int index) async {
    if (index < 0 || index >= state.length) return;
    final next = [...state]..removeAt(index);
    await setAll(next);
  }

  Future<void> clear() async {
    await setAll(const []);
  }
}

/// Toggle to show/hide background task sessions in the list.
/// When false (default), background tasks are collapsed under parent sessions.
final showBackgroundTasksProvider = StateProvider<bool>((ref) => false);

/// Whether the sessions screen is showing the dedicated Tasks tab.
final showTasksTabProvider = StateProvider<bool>((ref) => false);

/// Tracks which parent sessions have their children expanded.
/// Key: parent session ID, Value: true if expanded.
final expandedSessionsProvider =
    StateNotifierProvider<ExpandedSessionsNotifier, Set<String>>((ref) {
      return ExpandedSessionsNotifier();
    });

class ExpandedSessionsNotifier extends StateNotifier<Set<String>> {
  ExpandedSessionsNotifier() : super({});

  void toggle(String sessionId) {
    if (state.contains(sessionId)) {
      state = {...state}..remove(sessionId);
    } else {
      state = {...state, sessionId};
    }
  }

  void expand(String sessionId) {
    state = {...state, sessionId};
  }

  void collapse(String sessionId) {
    state = {...state}..remove(sessionId);
  }

  void collapseAll() {
    state = {};
  }

  bool isExpanded(String sessionId) => state.contains(sessionId);
}

/// Increment to force a reload of sessions/projects.
final sessionsRefreshTickProvider = StateProvider<int>((ref) => 0);
