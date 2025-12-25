import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/project.dart';
import '../models/session.dart';
import 'connection_provider.dart';
import 'service_providers.dart';

/// `null` means "all projects" (aggregate view).
final sessionsFilterProjectPathProvider = StateProvider<String?>((ref) => null);

/// Increment to force a reload of sessions/projects.
final sessionsRefreshTickProvider = StateProvider<int>((ref) => 0);

final sessionsListProvider = FutureProvider<List<SessionSummary>>((ref) async {
  ref.watch(sessionsRefreshTickProvider);
  final filterProjectPath = ref.watch(sessionsFilterProjectPathProvider);
  final connection = ref.watch(connectionProvider);
  final storage = ref.watch(storageServiceProvider);

  // In offline mode, return cached sessions
  if (connection.isOfflineMode) {
    final cached = await storage.getCachedSessions();
    if (filterProjectPath != null) {
      return cached.where((s) => s.directory == filterProjectPath).toList();
    }
    return cached;
  }

  final bridge = ref.watch(bridgeServiceProvider);
  final sessions = await bridge.listSessions(projectPath: filterProjectPath);

  // Cache the sessions for offline use (only when fetching all)
  if (filterProjectPath == null && sessions.isNotEmpty) {
    await storage.cacheSessions(sessions);
  }

  return sessions;
});

final projectsForSessionsProvider = FutureProvider<List<ProjectSummary>>((
  ref,
) async {
  ref.watch(sessionsRefreshTickProvider);
  final connection = ref.watch(connectionProvider);
  final storage = ref.watch(storageServiceProvider);

  // In offline mode, return cached projects
  if (connection.isOfflineMode) {
    return storage.getCachedProjects();
  }

  final bridge = ref.watch(bridgeServiceProvider);
  final projects = await bridge.listProjects();

  // Cache the projects for offline use
  if (projects.isNotEmpty) {
    await storage.cacheProjects(projects);
  }

  return projects;
});
