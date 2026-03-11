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
  final connection = ref.read(connectionProvider);
  if (connection.isOfflineMode) {
    return const [];
  }

  final bridge = ref.watch(piBridgeServiceProvider);
  return bridge.listSessions(projectPath: projectPath);
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
