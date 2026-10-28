import 'package:broski/models/codex.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/codex_settings_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/sheets/cx_skills_sheet_content.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Start a Codex review with the given [target].
/// Extracted from `_ChatScreenState._startCodexReview`.
///
/// [target] defaults to `{ type: 'uncommittedChanges' }` when omitted,
/// preserving the original behavior.
Future<void> startCodexReview({
  required WidgetRef ref,
  required String? cwd,
  Map<String, dynamic>? target,
}) async {
  if (cwd == null || cwd.isEmpty) return;
  final settings = ref.read(codexSettingsProvider);
  final sandboxPolicy = switch (settings.sandboxMode) {
    CodexSandboxMode.readOnly => const <String, dynamic>{'type': 'readOnly'},
    CodexSandboxMode.dangerFullAccess => const <String, dynamic>{
      'type': 'dangerFullAccess',
    },
    CodexSandboxMode.workspaceWrite => <String, dynamic>{
      'type': 'workspaceWrite',
      'writableRoots': [cwd],
      'networkAccess': settings.networkAccessEnabled,
    },
  };
  final config = <String, dynamic>{
    'web_search': settings.webSearchMode.wireValue,
    'features.skills': settings.skillsEnabled,
    'model_reasoning_effort': settings.reasoningEffort.wireValue,
    'model_reasoning_summary': settings.reasoningSummary.wireValue,
    if (settings.sandboxMode == CodexSandboxMode.workspaceWrite)
      'sandbox_workspace_write.network_access': settings.networkAccessEnabled,
  };
  final chatState = ref.read(chatSessionProvider);
  ref.read(chatSessionProvider.notifier).appendUserMessage('/review');
  ref.read(chatSessionProvider.notifier).setCodexStreaming(true);
  await ref
      .read(bridgeServiceProvider)
      .cxStartReview(
        threadId: chatState.cxThreadId,
        cwd: cwd,
        delivery: 'inline',
        target: target ?? const {'type': 'uncommittedChanges'},
        model: chatState.cxModel,
        approvalPolicy: settings.approvalPolicy.wireValue,
        sandbox: settings.sandboxMode.threadWireValue,
        sandboxPolicy: sandboxPolicy,
        config: config,
      );
}

/// Show the Codex skills sheet.
/// Extracted from `_ChatScreenState._showCodexSkillsSheet`.
void showCodexSkillsSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String? cwd,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Codex Skills',
    initialSize: 0.6,
    child: CxSkillsSheetContent(
      bridge: ref.read(bridgeServiceProvider),
      cwd: cwd,
      theme: theme,
    ),
  );
}

/// Set Codex reasoning effort by wireValue string.
/// Extracted from `_ChatScreenState._setCodexReasoningEffort`.
void setCodexReasoningEffort({
  required WidgetRef ref,
  required String? wireValue,
}) {
  if (wireValue == null) return;
  final effort = CodexReasoningEffort.values.firstWhere(
    (e) => e.wireValue == wireValue,
    orElse: () => CodexReasoningEffort.medium,
  );
  ref.read(codexSettingsProvider.notifier).setReasoningEffort(effort);
}
