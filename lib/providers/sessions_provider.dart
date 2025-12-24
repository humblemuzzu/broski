import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/project.dart';
import '../models/session.dart';
import 'service_providers.dart';

/// `null` means "all projects" (aggregate view).
final sessionsFilterProjectPathProvider = StateProvider<String?>((ref) => null);

/// Increment to force a reload of sessions/projects.
final sessionsRefreshTickProvider = StateProvider<int>((ref) => 0);

final sessionsListProvider = FutureProvider<List<SessionSummary>>((ref) async {
  ref.watch(sessionsRefreshTickProvider);
  final filterProjectPath = ref.watch(sessionsFilterProjectPathProvider);
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.listSessions(projectPath: filterProjectPath);
});

final projectsForSessionsProvider = FutureProvider<List<ProjectSummary>>((
  ref,
) async {
  ref.watch(sessionsRefreshTickProvider);
  final bridge = ref.watch(bridgeServiceProvider);
  return bridge.listProjects();
});

