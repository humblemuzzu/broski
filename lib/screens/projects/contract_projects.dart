import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/directory_summary.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/screens/agent/sessions/new_session_sheet.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What the projects list is read from: the chosen backend and, for a
/// contract backend, whether the bridge can be asked now.
typedef ProjectsSource = ({SelectedBackend backend, bool live});

/// It changes when the selection does and, for a contract backend, when the
/// bridge becomes reachable or is lost, so the list is read again then.
final projectsSourceProvider = Provider<ProjectsSource>((ref) {
  final selected = ref.watch(selectedBackendProvider);
  return (
    backend: selected,
    live: selected is ContractSelection && ref.watch(liveProvider),
  );
});

/// The projects of a contract backend: the directories its sessions work in,
/// the last saved list while the bridge cannot be asked. Fails with what the
/// bridge said when there is no list to show at all.
Future<List<ProjectSummary>> loadContractProjects(
  WidgetRef ref,
  BackendId backend,
) async {
  final state = await ref.read(directoriesProvider(backend).notifier).load();
  if (!state.loaded) {
    throw Exception(state.problem ?? 'The projects could not be loaded');
  }
  return [for (final directory in state.directories) _project(directory)];
}

/// A tap on a project: a new session in its directory, started from the
/// backend's own sheet, which opens the conversation.
Future<void> openContractProject(
  BuildContext context,
  WidgetRef ref,
  BackendId backend,
  ProjectSummary project,
) async {
  final descriptor = ref
      .read(backendsProvider)
      .backends
      .where((listed) => listed.id == backend)
      .firstOrNull;
  if (descriptor == null) return;
  ref.read(selectionProvider.notifier).selectProject(project);
  showNewSessionSheet(context, descriptor, directory: project.path);
}

ProjectSummary _project(DirectorySummary directory) {
  final segments = directory.cwd.split('/').where((part) => part.isNotEmpty);
  return ProjectSummary(
    id: directory.cwd,
    name: segments.isEmpty ? directory.cwd : segments.last,
    path: directory.cwd,
    lastOpened: directory.updatedAt,
  );
}
