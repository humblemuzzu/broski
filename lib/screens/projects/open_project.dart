import 'package:broski/models/agent_type.dart';
import 'package:broski/models/permission_rule.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/permission_rules_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/tool_settings_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/screens/projects/contract_projects.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens a project with the currently selected backend.
///
/// Every backend turns a tapped project into a chat differently, so the switch
/// is exhaustive: a new backend cannot silently inherit OpenCode's session
/// creation.
Future<void> openProjectForSelectedAgent({
  required BuildContext context,
  required WidgetRef ref,
  required ProjectSummary project,
}) {
  switch (ref.read(selectedBackendProvider)) {
    case LegacySelection(type: AgentType.claudeCode):
      return _openClaudeProject(context, ref, project);
    case LegacySelection(type: AgentType.codex):
      return _openCodexProject(context, ref, project);
    case LegacySelection(type: AgentType.opencode):
      return _openOpenCodeProject(context, ref, project);
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

Future<void> _openCodexProject(
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
          ChatScreen.codexDraft(cwd: project.path, title: project.name),
    ),
  );
}

Future<void> _openOpenCodeProject(
  BuildContext context,
  WidgetRef ref,
  ProjectSummary project,
) async {
  final connection = ref.read(connectionProvider);
  final selection = ref.read(selectionProvider.notifier);
  final chat = ref.read(chatSessionProvider.notifier);
  final storage = ref.read(storageServiceProvider);
  selection.selectProject(project);
  // In offline mode, try to find a cached session for this project
  if (connection.isOfflineMode) {
    final cachedSessions = await storage.getCachedSessions();
    final projectSessions = cachedSessions
        .where((s) => s.directory == project.path)
        .toList();
    if (projectSessions.isEmpty) {
      if (!context.mounted) return;
      showInfo(context, 'No cached sessions for this project');
      return;
    }
    // Use the most recent session
    projectSessions.sort((a, b) => b.time.updated - a.time.updated);
    final session = projectSessions.first;
    selection.selectSession(session);
    chat.setSession(session, projectPath: project.path);
    if (!context.mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen(project: project, session: session),
      ),
    );
    return;
  }
  final bridge = ref.read(bridgeServiceProvider);
  final baseRules = ref.read(permissionRulesProvider).effectiveRuleset;
  final disabledTools = ref.read(toolSettingsProvider).disabledTools;
  final permissionRules = applyDisabledToolsToRuleset(baseRules, disabledTools);
  final session = await bridge.createSession(
    projectPath: project.path,
    permission: permissionRules,
  );
  selection.selectSession(session);
  chat.setSession(session, projectPath: project.path);
  if (!context.mounted) return;
  await Navigator.push(
    context,
    MaterialPageRoute(
      builder: (_) => ChatScreen(project: project, session: session),
    ),
  );
}
