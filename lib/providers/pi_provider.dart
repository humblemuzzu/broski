import 'dart:async';

import 'package:broski/models/pi.dart';
import 'package:broski/models/pi_model_catalogue.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/pi/pi_sessions_notifier.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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

final piModelsProvider = FutureProvider.family<PiModelCatalogue, String?>((
  ref,
  projectPath,
) async {
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) {
    return PiModelCatalogue.empty;
  }

  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.listModelCatalogue(projectPath: projectPath);
});

final piSessionsProvider =
    StateNotifierProvider.family<
      PiSessionsNotifier,
      AsyncValue<List<PiSessionInfo>>,
      String?
    >((ref, projectPath) {
      final notifier = PiSessionsNotifier(
        bridge: ref.watch(piBridgeServiceProvider),
        storage: ref.watch(storageServiceProvider),
        deltas: ref.watch(bridgeServiceProvider).messages,
        isOffline: ref.read(connectionProvider).isOfflineMode,
        projectPath: projectPath,
      );
      unawaited(notifier.load());
      return notifier;
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

final piQueueProvider = FutureProvider.family<PiQueueState, String?>((
  ref,
  projectPath,
) async {
  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.getQueue(projectPath: projectPath);
});

final piLabelsProvider = FutureProvider.family<List<PiLabel>, String?>((
  ref,
  projectPath,
) async {
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) return const [];

  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.getLabels(projectPath: projectPath);
});

final piSessionTreeProvider = FutureProvider.family<PiSessionTree, String?>((
  ref,
  projectPath,
) async {
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) return const PiSessionTree();

  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.getSessionTree(projectPath: projectPath);
});
