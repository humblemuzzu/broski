import 'package:broski/models/agent_type.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/screens/projects/contract_projects.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens a project with the currently selected backend.
///
/// Every backend turns a tapped project into a chat differently, so the switch
/// is exhaustive.
Future<void> openProjectForSelectedAgent({
  required BuildContext context,
  required WidgetRef ref,
  required ProjectSummary project,
}) {
  switch (ref.read(selectedBackendProvider)) {
    case LegacySelection(type: AgentType.claudeCode):
      return _openClaudeProject(context, ref, project);
    case ContractSelection(:final id):
      return openContractProject(context, ref, id, project);
  }
}

Future<void> _openClaudeProject(
  BuildContext context,
  WidgetRef ref,
  ProjectSummary project,
) async {
  ref.read(selectionProvider.notifier).selectProject(project);
  if (!context.mounted) return;
  await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (_) =>
          ChatScreen.claudeCodeDraft(cwd: project.path, title: project.name),
    ),
  );
}
