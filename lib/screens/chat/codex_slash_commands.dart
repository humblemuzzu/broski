import 'dart:async';

import 'package:broski/models/codex.dart';
import 'package:broski/models/message.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/codex_settings_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Handles Codex client-side slash commands.
/// Returns true if the text was a recognized slash command (caller should return).
/// Extracted from chat_screen.dart `_sendMessage`.
bool handleCodexSlashCommand({
  required String text,
  required BuildContext context,
  required WidgetRef ref,
  required ChatSessionState chatState,
  required BridgeService bridge,
  required ChatSessionNotifier chat,
  required String cwd,
  required CodexSettings codexSettings,
  required TextEditingController controller,
  required VoidCallback scrollAndReset,
  required bool Function() isMounted,
  required VoidCallback showAppsSheet,
  required VoidCallback showRemoteSkillsSheet,
  required Future<void> Function() startReview,
  required void Function(DiffEntry) openDiffView,
  required VoidCallback loadSessionContext,
  required VoidCallback showRollbackSheet,
  required VoidCallback showAgentsSheet,
}) {
  if (text.startsWith('/model ')) {
    final nextModel = text.substring('/model '.length).trim();
    if (nextModel.isNotEmpty) {
      chat.appendUserMessage(text);
      chat.setCodexModel(nextModel);
      controller.clear();
      scrollAndReset();
    }
    return true;
  }
  if (text.startsWith('/approvals')) {
    final arg = text.replaceFirst('/approvals', '').trim().toLowerCase();
    final notifier = ref.read(codexSettingsProvider.notifier);
    final next = switch (arg) {
      'untrusted' ||
      'unless-trusted' ||
      'unlessTrusted' => CodexApprovalPolicy.unlessTrusted,
      'on-failure' ||
      'onfailure' ||
      'onFailure' => CodexApprovalPolicy.onFailure,
      'never' => CodexApprovalPolicy.never,
      'on-request' ||
      'onrequest' ||
      'onRequest' ||
      '' => CodexApprovalPolicy.onRequest,
      _ => CodexApprovalPolicy.onRequest,
    };
    chat.appendUserMessage(text);
    notifier.setApprovalPolicy(next);
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/sandbox')) {
    final arg = text.replaceFirst('/sandbox', '').trim().toLowerCase();
    final notifier = ref.read(codexSettingsProvider.notifier);
    final next = switch (arg) {
      'read-only' || 'readonly' || 'readOnly' => CodexSandboxMode.readOnly,
      'workspace-write' ||
      'workspacewrite' ||
      'workspaceWrite' => CodexSandboxMode.workspaceWrite,
      'danger-full-access' ||
      'dangerfullaccess' ||
      'dangerFullAccess' => CodexSandboxMode.dangerFullAccess,
      _ => CodexSandboxMode.readOnly,
    };
    chat.appendUserMessage(text);
    notifier.setSandboxMode(next);
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/effort')) {
    final arg = text.replaceFirst('/effort', '').trim().toLowerCase();
    final notifier = ref.read(codexSettingsProvider.notifier);
    final next = switch (arg) {
      'minimal' => CodexReasoningEffort.minimal,
      'low' => CodexReasoningEffort.low,
      'high' => CodexReasoningEffort.high,
      'xhigh' => CodexReasoningEffort.xhigh,
      'medium' || '' => CodexReasoningEffort.medium,
      _ => CodexReasoningEffort.medium,
    };
    chat.appendUserMessage(text);
    notifier.setReasoningEffort(next);
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/summary')) {
    final arg = text.replaceFirst('/summary', '').trim().toLowerCase();
    final notifier = ref.read(codexSettingsProvider.notifier);
    final next = switch (arg) {
      'concise' => CodexReasoningSummary.concise,
      'detailed' => CodexReasoningSummary.detailed,
      'none' => CodexReasoningSummary.none,
      'auto' || '' => CodexReasoningSummary.auto,
      _ => CodexReasoningSummary.auto,
    };
    chat.appendUserMessage(text);
    notifier.setReasoningSummary(next);
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/websearch')) {
    final arg = text.replaceFirst('/websearch', '').trim().toLowerCase();
    final mode = switch (arg) {
      'live' || 'on' || 'true' || '1' => CodexWebSearchMode.live,
      'cached' => CodexWebSearchMode.cached,
      _ => CodexWebSearchMode.disabled,
    };
    chat.appendUserMessage(text);
    ref.read(codexSettingsProvider.notifier).setWebSearchMode(mode);
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/skills')) {
    final arg = text.replaceFirst('/skills', '').trim().toLowerCase();
    final enabled = arg == 'on' || arg == 'true' || arg == '1';
    chat.appendUserMessage(text);
    ref.read(codexSettingsProvider.notifier).setSkillsEnabled(enabled);
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/personality')) {
    final arg = text.replaceFirst('/personality', '').trim().toLowerCase();
    final p = switch (arg) {
      'none' => CodexPersonality.none,
      'friendly' => CodexPersonality.friendly,
      'pragmatic' || '' => CodexPersonality.pragmatic,
      _ => CodexPersonality.pragmatic,
    };
    chat.appendUserMessage(text);
    ref.read(codexSettingsProvider.notifier).setPersonality(p);
    chat.appendLocalAssistantMessage('Personality set to: ${p.displayName}');
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/collab')) {
    final arg = text.replaceFirst('/collab', '').trim().toLowerCase();
    final mode = switch (arg) {
      'plan' => CodexCollaborationMode.plan,
      'default' || '' => CodexCollaborationMode.defaultMode,
      _ => CodexCollaborationMode.defaultMode,
    };
    chat.appendUserMessage(text);
    ref.read(codexSettingsProvider.notifier).setCollaborationMode(mode);
    chat.appendLocalAssistantMessage(
      'Collaboration mode set to: ${mode.displayName}',
    );
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/rename')) {
    final name = text.replaceFirst('/rename', '').trim();
    final threadId = chatState.cxThreadId;
    chat.appendUserMessage(text);
    if (threadId == null || threadId.isEmpty) {
      chat.appendLocalAssistantMessage('No Codex thread yet to rename.');
    } else if (name.isEmpty) {
      chat.appendLocalAssistantMessage('Usage: /rename <name>');
    } else {
      () async {
        try {
          await ref
              .read(bridgeServiceProvider)
              .cxRenameThread(threadId: threadId, name: name);
          if (isMounted()) {
            chat.appendLocalAssistantMessage('Thread renamed to: $name');
          }
        } catch (e) {
          if (isMounted()) {
            chat.appendLocalAssistantMessage(
              'Rename failed: ${humanizeError(e)}',
            );
          }
        }
      }();
    }
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text == '/fork') {
    final threadId = chatState.cxThreadId;
    chat.appendUserMessage(text);
    if (threadId == null || threadId.isEmpty) {
      chat.appendLocalAssistantMessage('No Codex thread yet to fork.');
    } else {
      () async {
        try {
          final forked = await ref
              .read(bridgeServiceProvider)
              .cxThreadFork(threadId: threadId);
          if (isMounted()) {
            chat.appendLocalAssistantMessage(
              'Thread forked! New thread: ${forked.displayTitle}',
            );
          }
        } catch (e) {
          if (isMounted()) {
            chat.appendLocalAssistantMessage(
              'Fork failed: ${humanizeError(e)}',
            );
          }
        }
      }();
    }
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text == '/apps') {
    chat.appendUserMessage(text);
    showAppsSheet();
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text == '/remote-skills') {
    chat.appendUserMessage(text);
    showRemoteSkillsSheet();
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/review')) {
    controller.clear();
    scrollAndReset();
    unawaited(startReview());
    return true;
  }
  if (text.startsWith('/diff')) {
    chat.appendUserMessage(text);
    final diffs = ref.read(chatSessionProvider).sessionDiffs;
    if (diffs.isEmpty) {
      chat.appendLocalAssistantMessage('No diff reported for this thread yet.');
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!isMounted()) return;
        openDiffView(diffs.first);
      });
    }
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/status')) {
    controller.clear();
    // Load fresh context data and open the sidebar
    loadSessionContext();
    Scaffold.of(context).openEndDrawer();
    return true;
  }
  if (text.startsWith('/compact')) {
    chat.appendUserMessage(text);
    chat.setCodexStreaming(true);
    bridge.cxChat(
      threadId: chatState.cxThreadId,
      cwd: cwd,
      prompt:
          'Compact/summarize this thread so far into a short, reusable memory.\n'
          'Include: goal, constraints, current progress, key decisions, next steps.\n'
          'Keep it concise and actionable.',
      model: chatState.cxModel,
      effort: codexSettings.reasoningEffort.wireValue,
      summary: codexSettings.reasoningSummary.wireValue,
      approvalPolicy: codexSettings.approvalPolicy.wireValue,
      sandbox: codexSettings.sandboxMode.threadWireValue,
      sandboxPolicy: switch (codexSettings.sandboxMode) {
        CodexSandboxMode.readOnly => const <String, dynamic>{
          'type': 'readOnly',
        },
        CodexSandboxMode.dangerFullAccess => const <String, dynamic>{
          'type': 'dangerFullAccess',
        },
        CodexSandboxMode.workspaceWrite => <String, dynamic>{
          'type': 'workspaceWrite',
          'writableRoots': [cwd],
          'networkAccess': codexSettings.networkAccessEnabled,
        },
      },
      config: <String, dynamic>{
        'web_search': codexSettings.webSearchMode.wireValue,
        'features.skills': codexSettings.skillsEnabled,
        'model_reasoning_effort': codexSettings.reasoningEffort.wireValue,
        'model_reasoning_summary': codexSettings.reasoningSummary.wireValue,
        if (codexSettings.sandboxMode == CodexSandboxMode.workspaceWrite)
          'sandbox_workspace_write.network_access':
              codexSettings.networkAccessEnabled,
      },
      collaborationMode: codexSettings.collaborationMode.wireValue,
      personality: codexSettings.personality.wireValue,
      serviceTier: codexSettings.serviceTier.wireValue,
    );
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/undo')) {
    final threadId = chatState.cxThreadId;
    chat.appendUserMessage(text);
    controller.clear();
    scrollAndReset();
    if (threadId == null || threadId.isEmpty) {
      chat.appendLocalAssistantMessage('No Codex thread yet to undo.');
    } else {
      // Run async undo operation
      () async {
        try {
          final reverted = await ref
              .read(bridgeServiceProvider)
              .cxUndoFiles(threadId: threadId);
          if (reverted.isEmpty) {
            chat.appendLocalAssistantMessage('No file changes to undo.');
          } else {
            chat.appendLocalAssistantMessage(
              'Reverted ${reverted.length} path(s):\n- ${reverted.join('\n- ')}',
            );
          }
        } catch (e) {
          chat.appendLocalAssistantMessage('Undo failed: ${humanizeError(e)}');
        }
      }();
    }
    return true;
  }
  if (text.startsWith('/rollback')) {
    chat.appendUserMessage(text);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!isMounted()) return;
      showRollbackSheet();
    });
    controller.clear();
    scrollAndReset();
    return true;
  }
  if (text.startsWith('/agents')) {
    chat.appendUserMessage(text);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!isMounted()) return;
      showAgentsSheet();
    });
    controller.clear();
    scrollAndReset();
    return true;
  }
  // /init - Create AGENTS.md with template (like Claude Code's /init)
  if (text.startsWith('/init')) {
    chat.appendUserMessage(text);
    controller.clear();
    scrollAndReset();
    () async {
      try {
        final agentsData = await bridge.cxReadAgentsMd(cwd);
        if (agentsData['exists'] == true) {
          chat.appendLocalAssistantMessage(
            'AGENTS.md already exists at ${agentsData['path']}.\n'
            'Use /agents to edit it.',
          );
        } else {
          // Create with template
          const template = '''# AGENTS.md
## Project Overview
Describe your project here.
## Build Commands
- `flutter run` - Run the app
- `flutter test` - Run tests
## Code Style
- Follow existing patterns
- Use meaningful variable names
## Constraints
- Don't modify generated files
- Always run tests before committing
''';
          final success = await bridge.cxWriteAgentsMd(
            cwd: cwd,
            content: template,
          );
          if (success) {
            chat.appendLocalAssistantMessage(
              'Created AGENTS.md at ${agentsData['path']}.\n'
              'Use /agents to customize it.',
            );
          } else {
            chat.appendLocalAssistantMessage('Failed to create AGENTS.md.');
          }
        }
      } catch (e) {
        chat.appendLocalAssistantMessage(humanizeError(e));
      }
    }();
    return true;
  }
  // /mcp - List MCP server status
  if (text.startsWith('/mcp')) {
    chat.appendUserMessage(text);
    controller.clear();
    scrollAndReset();
    () async {
      try {
        final servers = await bridge.cxListMcpServerStatus();
        if (servers.isEmpty) {
          chat.appendLocalAssistantMessage(
            'No MCP servers configured.\n'
            'Add servers to ~/.codex/config.toml under [mcp_servers].',
          );
        } else {
          final buf = StringBuffer('MCP Servers:\n');
          for (final s in servers) {
            final name = s['name'] ?? 'unknown';
            final status = s['status'] ?? 'unknown';
            final icon = status == 'connected' ? '●' : '○';
            buf.writeln('$icon $name ($status)');
          }
          chat.appendLocalAssistantMessage(buf.toString().trim());
        }
      } catch (e) {
        chat.appendLocalAssistantMessage(
          'Failed to list MCP servers: ${humanizeError(e)}',
        );
      }
    }();
    return true;
  }
  return false;
}
