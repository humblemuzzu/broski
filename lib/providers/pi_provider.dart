import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/pi.dart';
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
