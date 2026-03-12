import 'dart:async';
import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../models/message.dart';
import '../models/project.dart';
import '../models/runtime/runtime.dart';
import '../models/session.dart';
import '../services/bridge/bridge_runtime.dart';
import '../services/notification_service.dart';
import '../utils/project_path_match.dart';
import '../services/storage_service.dart';
import 'connection_provider.dart';
import 'pi_provider.dart';
import 'sessions/runtime_session_activity_handler.dart';
import 'sessions/runtime_session_snapshot_handler.dart';
import 'service_providers.dart';

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
    >((ref) {
      final notifier = GlobalSessionStatusNotifier(ref);
      ref.onDispose(() => notifier.dispose());
      return notifier;
    });

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

  StreamSubscription<Map<String, dynamic>>? _rawSubscription;
  StreamSubscription<RuntimeEvent>? _runtimeEventSubscription;
  StreamSubscription<RuntimeState>? _runtimeStateSubscription;
  StreamSubscription<List<RuntimeSessionSummary>>? _runtimeSessionsSubscription;
  final Set<AgentType> _runtimeSnapshotBackends = <AgentType>{};

  void _init() {
    final bridge = _ref.read(bridgeServiceProvider);
    _runtimeEventSubscription = bridge.runtimeEvents.listen(
      _handleRuntimeEvent,
    );
    _runtimeStateSubscription = bridge.runtimeStates.listen(
      _handleRuntimeState,
    );
    _runtimeSessionsSubscription = bridge.runtimeSessions.listen(
      _handleRuntimeSessions,
    );

    // Keep raw snapshots only as read-model fallback while runtime snapshots
    // prove out across reconnect and thread-list paths.
    _rawSubscription = bridge.messages.listen(_handleRawMessage);
  }

  void _handleRawMessage(Map<String, dynamic> message) {
    final type = message['type'] as String? ?? '';
    if (type == 'cx_threads' &&
        !_runtimeSnapshotBackends.contains(AgentType.codex)) {
      _handleCxThreadsSnapshot(message['data'] as List<dynamic>? ?? const []);
    }
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

  void _handleRuntimeSessions(List<RuntimeSessionSummary> sessions) {
    if (sessions.isEmpty) return;

    final backend = sessions.first.backend;
    _runtimeSnapshotBackends.add(backend);
    final updates = runtimeSessionStatusesFromSummaries(sessions);
    if (updates.isNotEmpty) {
      state = {...state, ...updates};
    }

    // When Pi broadcasts updated sessions, refresh the Pi sessions list
    // so the sessions screen stays in sync without manual pull-to-refresh.
    if (backend == AgentType.pi) {
      _ref.invalidate(piSessionsProvider(null));
    }
  }

  /// Seed Codex runtime status from thread/list payload (official v2 Thread.status).
  void _handleCxThreadsSnapshot(List<dynamic> threads) {
    final updates = <String, SessionStatus>{};
    for (final item in threads) {
      final map = item is Map<String, dynamic>
          ? item
          : item is Map
          ? item.cast<String, dynamic>()
          : null;
      if (map == null) continue;
      final id = map['id'] as String? ?? '';
      if (id.isEmpty) continue;
      final status = map['status'] as Map<String, dynamic>?;
      final statusType = status?['type'] as String? ?? 'idle';
      updates[id] = statusType == 'active'
          ? const SessionStatus.busy()
          : const SessionStatus.idle();
    }
    if (updates.isNotEmpty) {
      state = {...state, ...updates};
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
      _showCompletionNotification(
        sessionId,
        duration: duration,
        lastTool: lastTool,
      );
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
    // Get session info from cache if available
    _ref.read(storageServiceProvider).getCachedSessions().then((
      sessions,
    ) async {
      final ocSession = sessions.where((s) => s.id == sessionId).firstOrNull;
      if (ocSession != null) {
        final project = ocSession.directory.split('/').last;
        NotificationService.instance.showSessionCompleted(
          sessionId: sessionId,
          title: ocSession.title,
          projectName: project,
          duration: duration,
          lastTool: lastTool,
          additions: ocSession.summary?.additions,
          deletions: ocSession.summary?.deletions,
        );
        return;
      }

      // Claude Code fallback: use cached CC sessions (no additions/deletions summary)
      final ccSessions = await _ref
          .read(storageServiceProvider)
          .getCachedCCSessions();
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

      // Pi fallback: use cached Pi sessions
      final piSessions = await _ref
          .read(storageServiceProvider)
          .getCachedPiSessions();
      final piSession = piSessions.where((s) => s.id == sessionId).firstOrNull;
      if (piSession != null) {
        final title = (piSession.name ?? '').trim().isNotEmpty
            ? piSession.name!.trim()
            : piSession.firstMessage.trim().isNotEmpty
                ? piSession.firstMessage.trim()
                : 'Pi Session';
        final cwd = piSession.cwd;
        final project = cwd.split('/').where((p) => p.isNotEmpty).lastOrNull;

        NotificationService.instance.showSessionCompleted(
          sessionId: sessionId,
          title: title,
          projectName: project ?? 'Pi',
          duration: duration,
          lastTool: lastTool,
          additions: piSession.summary?.additions,
          deletions: piSession.summary?.deletions,
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
      final statuses = await bridge.getSessionStatus();

      // Claude Code fallback only while normalized runtime snapshots are not
      // yet available from the bridge.
      if (!_runtimeSnapshotBackends.contains(AgentType.claudeCode)) {
        final ccActive = await bridge.ccGetActiveSessions();
        for (final item in ccActive) {
          final sessionId = item['sessionId'] as String? ?? '';
          if (sessionId.isEmpty) continue;
          statuses[sessionId] = const SessionStatus.busy();
        }
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
    _rawSubscription?.cancel();
    _runtimeEventSubscription?.cancel();
    _runtimeStateSubscription?.cancel();
    _runtimeSessionsSubscription?.cancel();
    super.dispose();
  }
}

// ============================================================
// Predictive Prefetching
// ============================================================
// Preload messages for the top N visible sessions so opening them is instant.

/// Number of sessions to prefetch messages for
const int _prefetchSessionCount = 3;

/// Limit of messages to prefetch per session (just enough for preview)
const int _prefetchMessageLimit = 10;

/// Prefetch messages for a session (fire-and-forget, caches result)
final sessionMessagesPrefetchProvider =
    FutureProvider.family<List<ChatMessage>, String>((ref, sessionId) async {
      final storage = ref.watch(storageServiceProvider);

      // Check if already cached in memory
      final cached = await storage.getCachedMessages(sessionId);
      if (cached.isNotEmpty) {
        return cached; // Already have messages, no need to fetch
      }

      // Check if offline
      final connection = ref.watch(connectionProvider);
      if (connection.isOfflineMode) {
        return [];
      }

      // Fetch limited messages and cache them
      try {
        final bridge = ref.watch(bridgeServiceProvider);
        final rawMessages = await bridge.getSessionMessages(
          sessionId,
          limit: _prefetchMessageLimit,
        );

        // Parse and cache the messages
        final messages = _parseMessages(sessionId, rawMessages);
        if (messages.isNotEmpty) {
          await storage.cacheSessionMessages(sessionId, messages);
        }

        return messages;
      } catch (_) {
        return [];
      }
    });

/// Parse raw message data into ChatMessage objects
List<ChatMessage> _parseMessages(String sessionId, List<dynamic> rawMessages) {
  final messages = <ChatMessage>[];

  for (final item in rawMessages) {
    final map = item as Map<String, dynamic>;
    final info = map['info'] as Map<String, dynamic>? ?? const {};
    final parts = map['parts'] as List<dynamic>? ?? const [];
    final messageId = info['id'] as String? ?? '';
    final role = info['role'] as String? ?? 'assistant';
    final created =
        info['time']?['created'] as int? ??
        DateTime.now().millisecondsSinceEpoch;

    if (messageId.isEmpty) continue;

    var textBuffer = StringBuffer();
    final tools = <ToolCall>[];

    for (final partItem in parts) {
      final part = partItem as Map<String, dynamic>;
      final partType = part['type'] as String? ?? '';
      if (partType == 'text') {
        textBuffer.write(part['text'] as String? ?? '');
      }
      if (partType == 'tool') {
        final partId = part['id'] as String? ?? '';
        final callId = part['callID'] as String? ?? '';
        final toolName = part['tool'] as String? ?? 'tool';
        final stateInfo = part['state'] as Map<String, dynamic>? ?? const {};
        final status = stateInfo['status'] as String? ?? 'completed';
        final title = stateInfo['title'] as String?;
        final input = stateInfo['input'] as Map<String, dynamic>? ?? const {};
        final output = stateInfo['output'] as String?;
        final metadataRaw = stateInfo['metadata'];
        final metadata = metadataRaw is Map<String, dynamic>
            ? metadataRaw
            : const <String, dynamic>{};
        if (callId.isNotEmpty) {
          tools.add(
            ToolCall(
              callId: callId,
              partId: partId.isNotEmpty ? partId : callId,
              name: toolName,
              status: status,
              title: title,
              input: input,
              output: output,
              metadata: metadata,
            ),
          );
        }
      }
    }

    messages.add(
      ChatMessage(
        id: messageId,
        sessionId: sessionId,
        role: role == 'user' ? MessageRole.user : MessageRole.assistant,
        createdAt: DateTime.fromMillisecondsSinceEpoch(created),
        text: textBuffer.toString(),
        toolCalls: tools,
      ),
    );
  }

  return messages;
}

/// Trigger prefetching for top N sessions (call this from UI when sessions are visible)
void prefetchTopSessions(WidgetRef ref, List<SessionSummary> sessions) {
  // Prefetch messages for top N sessions in parallel
  final sessionsToFetch = sessions.take(_prefetchSessionCount);
  for (final session in sessionsToFetch) {
    // Fire-and-forget: read the provider to trigger prefetch
    ref.read(sessionMessagesPrefetchProvider(session.id));
  }
}

/// `null` means "all projects" (aggregate view).
final sessionsFilterProjectPathProvider = StateProvider<String?>((ref) => null);

/// Server-side search query for sessions.
/// Updated by the search bar with debouncing.
final sessionsSearchQueryProvider = StateProvider<String>((ref) => '');

/// Per-project session display limit.
/// Default: show 5 sessions per project group, "Load more" expands.
const int kSessionsPerProjectDefault = 5;

/// Tracks which project directories have been expanded to show all sessions.
final sessionsProjectExpandedProvider =
    StateNotifierProvider<_ProjectExpandedNotifier, Set<String>>((ref) {
      return _ProjectExpandedNotifier();
    });

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

final cxProjectExpandedProvider =
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

/// Stale-while-revalidate pattern: yields cached data immediately, then fresh data.
/// This provides instant perceived speed while still fetching fresh data.
/// TTL optimization: Skip network if cache is < 30s old (prevents unnecessary fetches).
/// Supports server-side search via [sessionsSearchQueryProvider].
final sessionsListProvider = StreamProvider<List<SessionSummary>>((ref) async* {
  ref.watch(sessionsRefreshTickProvider);
  final filterProjectPath = ref.watch(sessionsFilterProjectPathProvider);
  final titleFilters = ref.watch(
    sessionsTitleExcludeFiltersProvider(AgentType.opencode),
  );
  final searchQuery = ref.watch(sessionsSearchQueryProvider).trim();
  final connection = ref.watch(connectionProvider);
  final storage = ref.watch(storageServiceProvider);

  List<SessionSummary> applyFilters(List<SessionSummary> sessions) {
    var result = sessions.where(
      (s) => projectPathMatches(s.directory, filterProjectPath),
    );
    if (titleFilters.isNotEmpty) {
      result = result.where(
        (s) => !sessionTitleMatchesExcludeFilters(s.title, titleFilters),
      );
    }
    // Client-side search fallback (for cached data before server response)
    if (searchQuery.isNotEmpty) {
      final q = searchQuery.toLowerCase();
      result = result.where((s) => s.title.toLowerCase().contains(q));
    }
    return result.toList();
  }

  // STEP 1: Immediately yield cached data (instant perceived load)
  final cached = await storage.getCachedSessions();
  if (cached.isNotEmpty) {
    final filtered = applyFilters(cached);
    if (filtered.isNotEmpty) {
      yield filtered;
    }
  }

  // STEP 2: If offline, stop here - we've already yielded cache
  if (connection.isOfflineMode) {
    // If no cached data was yielded, yield empty list
    if (cached.isEmpty) {
      yield [];
    }
    return;
  }

  // STEP 3: TTL check - skip network if cache is fresh (< 30s old)
  // BUT if searching, always fetch (server has better search than client)
  if (searchQuery.isEmpty &&
      cached.isNotEmpty &&
      storage.isSessionsCacheFresh()) {
    // Cache is fresh and no search, no need to fetch - we already yielded cached data
    return;
  }

  // STEP 4: Fetch fresh data in background and yield when ready
  try {
    final bridge = ref.watch(bridgeServiceProvider);
    final freshAll = await bridge.listSessions(
      projectPath: null,
      search: searchQuery.isNotEmpty ? searchQuery : null,
    );

    // Cache the sessions for offline use (only full fetches, not search results)
    if (searchQuery.isEmpty && freshAll.isNotEmpty) {
      await storage.cacheSessions(freshAll);
    }

    // Apply project filter + title filters (search already applied server-side)
    var fresh = freshAll.where(
      (s) => projectPathMatches(s.directory, filterProjectPath),
    );
    if (titleFilters.isNotEmpty) {
      fresh = fresh.where(
        (s) => !sessionTitleMatchesExcludeFilters(s.title, titleFilters),
      );
    }

    yield fresh.toList();
  } catch (e) {
    // If fresh fetch fails but we already yielded cached data, that's fine
    // Only rethrow if we have no data to show
    if (cached.isEmpty) {
      rethrow;
    }
    // Otherwise, silently continue with cached data
  }
});

/// A session with its child (background task) sessions grouped together.
class SessionWithChildren {
  const SessionWithChildren({required this.session, this.children = const []});

  final SessionSummary session;
  final List<SessionSummary> children;

  /// Whether this session has any background task children
  bool get hasChildren => children.isNotEmpty;

  /// Number of active (busy/retry) child sessions
  int activeChildCount(Map<String, SessionStatus> statuses) {
    return children.where((c) {
      final status = statuses[c.id];
      return status != null && (status.isBusy || status.isRetry);
    }).length;
  }
}

/// Groups sessions by parent/child relationship.
/// Root sessions and forked sessions become the main entries.
/// Only background tasks (isBackgroundTask) are nested under their parent.
final groupedSessionsProvider = Provider<List<SessionWithChildren>>((ref) {
  final sessionsAsync = ref.watch(sessionsListProvider);
  final sessions = sessionsAsync.valueOrNull ?? [];

  // Separate main sessions (root + forked) and background task children
  final mainSessions = <SessionSummary>[];
  final childrenByParent = <String, List<SessionSummary>>{};

  for (final session in sessions) {
    if (session.isRootSession || session.isForkedSession) {
      // Root sessions and forked sessions appear as main entries
      mainSessions.add(session);
    } else if (session.isBackgroundTask) {
      // Only background tasks are nested under parent
      final parentId = session.parentID!;
      childrenByParent.putIfAbsent(parentId, () => []).add(session);
    }
  }

  // Sort main sessions by updated time (newest first)
  mainSessions.sort((a, b) => b.time.updated.compareTo(a.time.updated));

  // Build grouped list
  return mainSessions.map((main) {
    final children = childrenByParent[main.id] ?? [];
    // Sort children by updated time (newest first)
    children.sort((a, b) => b.time.updated.compareTo(a.time.updated));
    return SessionWithChildren(session: main, children: children);
  }).toList();
});

/// Stale-while-revalidate for projects: yields cached immediately, then fresh.
/// TTL optimization: Skip network if cache is < 30s old.
final projectsForSessionsProvider = StreamProvider<List<ProjectSummary>>((
  ref,
) async* {
  ref.watch(sessionsRefreshTickProvider);
  final connection = ref.watch(connectionProvider);
  final storage = ref.watch(storageServiceProvider);

  // STEP 1: Immediately yield cached data
  final cached = await storage.getCachedProjects();
  if (cached.isNotEmpty) {
    yield cached;
  }

  // STEP 2: If offline, stop here
  if (connection.isOfflineMode) {
    if (cached.isEmpty) {
      yield [];
    }
    return;
  }

  // STEP 3: TTL check - skip network if cache is fresh
  if (cached.isNotEmpty && storage.isProjectsCacheFresh()) {
    return;
  }

  // STEP 4: Fetch fresh data
  try {
    final bridge = ref.watch(bridgeServiceProvider);
    final fresh = await bridge.listProjects();

    if (fresh.isNotEmpty) {
      // Cache for offline use
      await storage.cacheProjects(fresh);
      yield fresh;
    } else if (cached.isEmpty) {
      // Bridge returned empty and no cache – derive from cached sessions
      final sessions = await storage.getCachedSessions();
      final byPath = <String, ProjectSummary>{};
      for (final s in sessions) {
        final path = s.directory;
        if (path.isEmpty) continue;
        final parts = path.split('/').where((p) => p.isNotEmpty).toList();
        final name = parts.isEmpty ? path : parts.last;
        byPath[path] = ProjectSummary(id: path, name: name, path: path);
      }
      final derived = byPath.values.toList()
        ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
      yield derived;
    }
    // If fresh is empty but cache was non-empty, keep cached data (already yielded in step 1)
  } catch (e) {
    if (cached.isEmpty) {
      rethrow;
    }
  }
});

/// Derived project list for filter sheet — merges bridge-API projects with
/// projects derived from the session cache. Guarantees the filter always has
/// entries when sessions are visible: bridge projects cover "known projects"
/// and session-derived projects cover "if sessions exist, projects exist".
final ocFilterProjectsProvider = FutureProvider<List<ProjectSummary>>((
  ref,
) async {
  // Re-derive whenever sessions refresh
  ref.watch(sessionsRefreshTickProvider);
  final storage = ref.watch(storageServiceProvider);

  final byPath = <String, ProjectSummary>{};

  // Source 1: Bridge API projects (may have better names)
  final bridgeProjects = ref.watch(projectsForSessionsProvider);
  for (final p in bridgeProjects.valueOrNull ?? <ProjectSummary>[]) {
    byPath[p.path] = p;
  }

  // Source 2: Session cache (full unfiltered set — always stored by
  // sessionsListProvider regardless of filter). This is the guaranteed source.
  final allSessions = await storage.getCachedSessions();
  for (final s in allSessions) {
    final path = s.directory;
    if (path.isEmpty) continue;
    if (byPath.containsKey(path)) continue; // bridge name wins
    final parts = path.split('/').where((p) => p.isNotEmpty).toList();
    final name = parts.isEmpty ? path : parts.last;
    byPath[path] = ProjectSummary(id: path, name: name, path: path);
  }

  return byPath.values.toList()
    ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
});
