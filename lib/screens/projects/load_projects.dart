import 'package:broski/models/project.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/projects/contract_projects.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The projects of the backend the person chose, read once the stored choice
/// is known, so a contract backend's tab never asks the old protocol first.
Future<List<ProjectSummary>> loadProjectsForSelection(WidgetRef ref) async {
  await ref.read(selectedBackendProvider.notifier).ready;
  if (ref.read(selectedBackendProvider) case ContractSelection(:final id)) {
    return loadContractProjects(ref, id);
  }
  return _loadClaudeProjects(ref);
}

/// The old Claude Code's projects: live first, the cache when the bridge
/// cannot be reached or the app is offline.
Future<List<ProjectSummary>> _loadClaudeProjects(WidgetRef ref) async {
  final connection = ref.read(connectionProvider);
  final storage = ref.read(storageServiceProvider);
  if (connection.isOfflineMode) {
    return storage.getCachedCCProjects();
  }
  try {
    final projects = await ref.read(bridgeServiceProvider).ccListProjects();
    if (projects.isNotEmpty) {
      await storage.cacheCCProjects(projects);
    }
    return projects;
  } catch (e) {
    final cached = await storage.getCachedCCProjects();
    if (cached.isNotEmpty) return cached;
    rethrow;
  }
}
