import 'package:broski/models/agent_type.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/session.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/widgets/project_tools_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the project tools sheet.
/// Extracted from `_ChatScreenState._showProjectToolsSheet`.
void showProjectToolsSheetAction({
  required BuildContext context,
  required WidgetRef ref,
  required bool isClaudeCode,
  required bool isCodex,
  required String projectName,
  required String effectivePath,
  required ProjectSummary project,
  required SessionSummary session,
}) {
  final backend = isClaudeCode
      ? AgentType.claudeCode
      : isCodex
      ? AgentType.codex
      : AgentType.opencode;
  final usesSelectedProject = backend == AgentType.opencode;
  final resolvedProject = usesSelectedProject
      ? project
      : ProjectSummary(id: '', name: projectName, path: effectivePath);
  ref.read(selectionProvider.notifier).selectProject(resolvedProject);
  if (usesSelectedProject && session.id.isNotEmpty) {
    ref.read(selectionProvider.notifier).selectSession(session);
  }
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) =>
        ProjectToolsSheet(backend: backend, project: resolvedProject),
  );
}
