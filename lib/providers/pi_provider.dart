import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/pi.dart';
import '../models/project.dart';
import '../services/pi_bridge_service.dart';
import 'connection_provider.dart';
import 'service_providers.dart';

final piBridgeServiceProvider = Provider<PiBridgeService>((ref) {
  final socket = ref.watch(webSocketServiceProvider);
  final service = PiBridgeService(socket);
  ref.onDispose(service.dispose);
  return service;
});

final piStateProvider = FutureProvider.family<PiState, String?>((
  ref,
  projectPath,
) async {
  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.getState(projectPath: projectPath);
});

final piModelsProvider = FutureProvider.family<List<PiModel>, String?>((
  ref,
  projectPath,
) async {
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) {
    return const [];
  }

  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.listModels(projectPath: projectPath);
});

final piSessionsProvider = FutureProvider.family<List<PiSessionInfo>, String?>((
  ref,
  projectPath,
) async {
  final bridge = ref.watch(piBridgeServiceProvider);
  final storage = ref.watch(storageServiceProvider);
  final connection = ref.read(connectionProvider);

  if (connection.isOfflineMode) {
    if (projectPath == null) {
      return storage.getCachedPiSessions();
    }
    return const [];
  }

  try {
    final sessions = await bridge.listSessions(projectPath: projectPath);
    // Cache on success (only for "all sessions" query)
    if (projectPath == null) {
      await storage.cachePiSessions(sessions);
    }
    return sessions;
  } catch (e) {
    // Fall back to cache when offline or on error
    if (projectPath == null) {
      final cached = await storage.getCachedPiSessions();
      if (cached.isNotEmpty) return cached;
    }
    return const [];
  }
});

final piCommandsProvider = FutureProvider.family<List<PiCommand>, String?>((
  ref,
  projectPath,
) async {
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) {
    return const [];
  }

  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.listCommands(projectPath: projectPath);
});

final piSessionStatsProvider = FutureProvider.family<PiSessionStats, String?>((
  ref,
  projectPath,
) async {
  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.getSessionStats(projectPath: projectPath);
});

final piStreamMessagesProvider = StreamProvider.autoDispose<PiStreamMessage>((
  ref,
) {
  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.streamMessages;
});

/// Filter CWD for Pi sessions list (null = show all).
final piSessionsFilterCwdProvider = StateProvider<String?>((ref) => null);

/// Project list for Pi sessions screen (used by Projects tab & "New Session" sheet).
/// Online: calls `pi_list_projects` (derives from Pi sessions on the bridge).
/// Offline: uses cached Pi projects, falls back to deriving from cached sessions.
final piProjectsForSessionsProvider = FutureProvider<List<ProjectSummary>>((
  ref,
) async {
  final piBridge = ref.watch(piBridgeServiceProvider);
  final storage = ref.watch(storageServiceProvider);
  final connection = ref.read(connectionProvider);

  Future<List<ProjectSummary>> fromCachedSessions() async {
    final cached = await storage.getCachedPiSessions();
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
    final cached = await storage.getCachedPiProjects();
    if (cached.isNotEmpty) return cached;
    return await fromCachedSessions();
  }

  try {
    final projects = await piBridge.listProjects();
    if (projects.isNotEmpty) {
      await storage.cachePiProjects(projects);
      return projects;
    }
    return await fromCachedSessions();
  } catch (_) {
    final cached = await storage.getCachedPiProjects();
    if (cached.isNotEmpty) return cached;
    return await fromCachedSessions();
  }
});

/// Unique projects derived from Pi sessions (for project filter chip).
final piFilterProjectsProvider = FutureProvider<List<ProjectSummary>>((
  ref,
) async {
  final sessions = ref.watch(piSessionsProvider(null)).valueOrNull ?? const [];
  final byPath = <String, ProjectSummary>{};
  for (final s in sessions) {
    final path = s.cwd;
    if (path.isEmpty || byPath.containsKey(path)) continue;
    final parts = path.split('/').where((p) => p.isNotEmpty).toList();
    byPath[path] = ProjectSummary(
      id: path,
      name: parts.isEmpty ? 'Project' : parts.last,
      path: path,
    );
  }
  final sorted = byPath.values.toList()
    ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  return sorted;
});

final piToolsProvider = FutureProvider.family<List<PiTool>, String?>((
  ref,
  projectPath,
) async {
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) {
    return const [];
  }

  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.getTools(projectPath: projectPath);
});

final piThinkingCapabilitiesProvider =
    FutureProvider.family<PiThinkingCapabilities, String?>((
      ref,
      projectPath,
    ) async {
      final bridge = ref.watch(piBridgeServiceProvider);
      return bridge.getThinkingCapabilities(projectPath: projectPath);
    });

final piAllModelsProvider = FutureProvider.family<List<PiModel>, String?>((
  ref,
  projectPath,
) async {
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) {
    return const [];
  }

  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.listAllModels(projectPath: projectPath);
});

final piQueueProvider = FutureProvider.family<PiQueueState, String?>((
  ref,
  projectPath,
) async {
  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.getQueue(projectPath: projectPath);
});

/// Prefetch messages for the top N Pi sessions to speed up opening.
void prefetchTopPiSessions(
  WidgetRef ref,
  List<PiSessionInfo> sessions, {
  int count = 3,
}) {
  final bridge = ref.read(piBridgeServiceProvider);
  for (final session in sessions.take(count)) {
    // Fire and forget — just warm the cache
    bridge
        .getMessages(projectPath: session.cwd)
        .catchError((_) => <Map<String, dynamic>>[]);
  }
}
