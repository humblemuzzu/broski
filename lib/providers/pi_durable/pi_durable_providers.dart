import 'package:broski/models/agent_type.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/runtime/runtime_model_summary.dart';
import 'package:broski/models/runtime/runtime_session_summary.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final piDurableSessionsProvider = FutureProvider<List<RuntimeSessionSummary>>((
  ref,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  final raw = await bridge.unifiedListSessions(backend: AgentType.piDurable);
  return raw.map(RuntimeSessionSummary.fromJson).toList();
});

final piDurableModelsProvider = FutureProvider<List<RuntimeModelSummary>>((
  ref,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  final raw = await bridge.unifiedListModels(backend: AgentType.piDurable);
  return raw.map(RuntimeModelSummary.fromJson).toList();
});

/// Projects a durable session can be created in: the ones the durable backend
/// already knows about, plus the projects the app already tracks, so a first
/// durable session is possible before the backend has any.
final piDurableProjectsProvider = FutureProvider<List<ProjectSummary>>((
  ref,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  final raw = await bridge.unifiedListProjects(backend: AgentType.piDurable);
  final byPath = <String, ProjectSummary>{
    for (final project in raw.map(ProjectSummary.fromJson))
      if (project.path.isNotEmpty) project.path: project,
  };
  try {
    for (final project in await bridge.listProjects()) {
      if (project.path.isEmpty) continue;
      byPath.putIfAbsent(project.path, () => project);
    }
  } catch (_) {
    // Durable-only projects are still usable.
  }
  final projects = byPath.values.toList()
    ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
  return projects;
});
