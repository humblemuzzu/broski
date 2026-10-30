import 'dart:convert';

import 'package:broski/models/agent.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/message.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/claude_code_variant_provider.dart';
import 'package:broski/providers/codex/cx_output_schema_provider.dart';
import 'package:broski/providers/codex_settings_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/opencode_variant_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/codex_slash_commands.dart';
import 'package:broski/utils/opencode_id.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Builds display text with file attachment labels appended.
String _buildDisplayText(String text, List<FileAttachment> attachedFiles) {
  if (attachedFiles.isEmpty) return text;
  final labels = <String>[];
  int imageCount = 0;
  for (final f in attachedFiles) {
    if (f.isImage) {
      imageCount++;
      labels.add('[Image $imageCount]');
    } else {
      labels.add(f.displayPath);
    }
  }
  return labels.isNotEmpty ? '$text\n${labels.join(' ')}' : text;
}

/// Sends a chat message, routing to the appropriate agent.
/// Extracted from chat_screen.dart `_sendMessage`.
void sendMessage({
  required BuildContext context,
  required WidgetRef ref,
  required BridgeConnectionState connection,
  required ChatSessionState chatState,
  required TextEditingController controller,
  required List<FileAttachment> attachedFiles,
  required String? selectedAgent,
  required List<Agent> agents,
  required bool isClaudeCode,
  required bool isCodex,
  ClaudeCodeSession? ccSession,
  String? ccDraftCwd,
  String? ccDraftModel,
  String? ccResumeSessionAtMessageId,
  CodexThread? cxThread,
  String? cxDraftCwd,
  required String sessionId,
  required String projectPath,
  required VoidCallback clearAttachments,
  required VoidCallback scrollToBottom,
  required VoidCallback onCcResumeIdCleared,
  required bool Function() isMounted,
  required VoidCallback showCodexAppsSheet,
  required Future<void> Function() startCodexReview,
  required void Function(DiffEntry) openDiffView,
  required VoidCallback loadSessionContext,
  required VoidCallback showCodexAgentsSheet,
}) {
  final text = controller.text.trim();
  final hasAttachments = attachedFiles.isNotEmpty;
  if (text.isEmpty && !hasAttachments) return;
  if (!connection.isConnected) return;

  // Check for streaming state (different per agent)
  if (isClaudeCode) {
    if (chatState.ccIsStreaming) {
      // CC SDK single-message mode doesn't support mid-turn queuing.
      // Queue the message locally and auto-send when the turn completes.
      final chat = ref.read(chatSessionProvider.notifier);
      chat.setPendingCCMessage(
        text,
        attachments: hasAttachments ? attachedFiles.toList() : null,
      );
      controller.clear();
      clearAttachments();
      return;
    }
  } else if (isCodex) {
    // Codex mid-turn: steer the agent instead of blocking.
    if (chatState.cxIsStreaming) {
      final threadId = chatState.cxThreadId;
      if (threadId != null && threadId.isNotEmpty) {
        ref
            .read(bridgeServiceProvider)
            .cxSteer(threadId: threadId, prompt: text);
        ref.read(chatSessionProvider.notifier).appendUserMessage(text);
        controller.clear();
        clearAttachments();
      }
      return;
    }
  }
  // OpenCode: no block — SDK's promptAsync() returns 204 immediately

  final bridge = ref.read(bridgeServiceProvider);
  final chat = ref.read(chatSessionProvider.notifier);
  final selectedModel = ref.read(selectionProvider).model;

  // Parse @agent mention from message text
  String? messageAgent = selectedAgent;
  final agentMatch = RegExp(r'@(\w+)(?:\s|$)').firstMatch(text);
  if (agentMatch != null) {
    final mentionedAgent = agentMatch.group(1)?.toLowerCase();
    final matchedAgent = agents.firstWhere(
      (a) => a.name.toLowerCase() == mentionedAgent,
      orElse: () => const Agent(name: '', mode: AgentMode.primary),
    );
    if (matchedAgent.name.isNotEmpty) {
      messageAgent = matchedAgent.name;
    }
  }

  final isOpenCode = !isClaudeCode && !isCodex;
  // OpenCode Plan Mode: Use plan agent when in plan mode (unless overridden)
  if (isOpenCode && messageAgent == null) {
    if (chatState.ocAgentMode == 'plan') messageAgent = 'plan';
  }

  // ── Claude Code ──────────────────────────────────────────────────
  if (isClaudeCode) {
    final ccConfig = ref.read(ccConfigProvider).valueOrNull;
    final cwd = chatState.ccCwd ?? ccSession?.cwd ?? ccDraftCwd;
    final model =
        ccConfig?.model ??
        chatState.ccModel ??
        chatState.ccInit?.model ??
        ccSession?.model ??
        ccDraftModel;
    final activeSubagent = messageAgent ?? ccConfig?.activeSubagent;
    chat.appendUserMessage(_buildDisplayText(text, attachedFiles));
    chat.setCCStreaming(true);
    final ccVariant = ref.read(claudeCodeVariantProvider).selectedVariant;
    bridge.ccChat(
      sessionId: chatState.ccSessionId,
      prompt: text,
      cwd: cwd,
      model: model,
      permissionMode: ccConfig?.permissionMode,
      allowedTools: ccConfig?.allowedTools,
      disallowedTools: ccConfig?.disallowedTools,
      maxTurns: ccConfig?.maxTurns,
      maxBudgetUsd: ccConfig?.maxBudgetUsd,
      betas: ccConfig?.betas,
      variant: ccVariant,
      thinking: ccConfig?.thinking,
      effort: ccConfig?.effort,
      activeSubagent: activeSubagent,
      resumeSessionAt: ccResumeSessionAtMessageId,
      outputFormat: ccConfig?.outputFormat,
      sandbox: ccConfig?.sandbox,
      enableAgentTeams: ccConfig?.enableAgentTeams,
      enableClaudeAiMcpServers: ccConfig?.enableClaudeAiMcpServers,
      fileAttachments: hasAttachments ? attachedFiles : null,
    );
    onCcResumeIdCleared();
    controller.clear();
    clearAttachments();
    scrollToBottom();
    return;
  }

  // ── Codex ────────────────────────────────────────────────────────
  if (isCodex) {
    final cwd = chatState.cxCwd ?? cxThread?.cwd ?? cxDraftCwd;
    if (cwd == null || cwd.isEmpty) return;
    final codexSettings = ref.read(codexSettingsProvider);
    // Try client-side slash commands first
    if (handleCodexSlashCommand(
      text: text,
      context: context,
      ref: ref,
      chatState: chatState,
      bridge: bridge,
      chat: chat,
      cwd: cwd,
      codexSettings: codexSettings,
      controller: controller,
      scrollAndReset: scrollToBottom,
      isMounted: isMounted,
      showAppsSheet: showCodexAppsSheet,
      startReview: startCodexReview,
      openDiffView: openDiffView,
      loadSessionContext: loadSessionContext,
      showAgentsSheet: showCodexAgentsSheet,
    )) {
      return;
    }
    // Not a slash command — send actual Codex chat
    chat.appendUserMessage(_buildDisplayText(text, attachedFiles));
    chat.setCodexStreaming(true);
    final sandboxPolicy = switch (codexSettings.sandboxMode) {
      CodexSandboxMode.readOnly => const <String, dynamic>{'type': 'readOnly'},
      CodexSandboxMode.dangerFullAccess => const <String, dynamic>{
        'type': 'dangerFullAccess',
      },
      CodexSandboxMode.workspaceWrite => <String, dynamic>{
        'type': 'workspaceWrite',
        'writableRoots': [cwd],
        'networkAccess': codexSettings.networkAccessEnabled,
      },
    };
    final config = <String, dynamic>{
      'web_search': codexSettings.webSearchMode.wireValue,
      'features.skills': codexSettings.skillsEnabled,
      'model_reasoning_effort': codexSettings.reasoningEffort.wireValue,
      'model_reasoning_summary': codexSettings.reasoningSummary.wireValue,
      if (codexSettings.sandboxMode == CodexSandboxMode.workspaceWrite)
        'sandbox_workspace_write.network_access':
            codexSettings.networkAccessEnabled,
    };
    // Parse output schema if set
    final schemaStr = ref.read(cxOutputSchemaProvider);
    Map<String, dynamic>? outputSchema;
    if (schemaStr != null && schemaStr.isNotEmpty) {
      try {
        outputSchema = jsonDecode(schemaStr) as Map<String, dynamic>?;
      } catch (_) {
        // Invalid JSON — ignore
      }
    }
    bridge.cxChat(
      threadId: chatState.cxThreadId,
      cwd: cwd,
      prompt: text,
      model: chatState.cxModel,
      effort: codexSettings.reasoningEffort.wireValue,
      summary: codexSettings.reasoningSummary.wireValue,
      approvalPolicy: codexSettings.approvalPolicy.wireValue,
      sandbox: codexSettings.sandboxMode.threadWireValue,
      sandboxPolicy: sandboxPolicy,
      config: config,
      fileAttachments: hasAttachments ? attachedFiles : null,
      collaborationMode: codexSettings.collaborationMode.wireValue,
      personality: codexSettings.personality.wireValue,
      serviceTier: codexSettings.serviceTier.wireValue,
      outputSchema: outputSchema,
    );
    controller.clear();
    clearAttachments();
    scrollToBottom();
    return;
  }

  // ── OpenCode ─────────────────────────────────────────────────────
  // Every other backend returned above; what is left must not be turned into
  // an OpenCode prompt just because it is not Claude Code or Codex.
  if (!isOpenCode) return;

  // Check if this is a slash command (attachments not supported for commands)
  if (text.startsWith('/') && !hasAttachments) {
    final parts = text.substring(1).split(' ');
    final commandName = parts[0];
    final arguments = parts.length > 1 ? parts.sublist(1).join(' ') : '';
    chat.appendUserMessage(text);
    bridge.executeCommand(
      sessionId: sessionId,
      command: commandName,
      arguments: arguments,
      projectPath: projectPath,
      agent: messageAgent,
      model: selectedModel != null
          ? '${selectedModel.providerID}/${selectedModel.modelID}'
          : null,
    );
  } else {
    final displayText = _buildDisplayText(text, attachedFiles);
    final clientMessageId = OpenCodeId.newMessageId();
    chat.appendUserMessage(displayText, messageId: clientMessageId);
    final variantState = ref.read(openCodeVariantProvider);
    final variant = variantState.getVariant(selectedModel);
    bridge.sendChat(
      sessionId: sessionId,
      content: text,
      messageId: clientMessageId,
      projectPath: projectPath,
      providerID: selectedModel?.providerID,
      modelID: selectedModel?.modelID,
      agent: messageAgent,
      fileAttachments: hasAttachments ? attachedFiles : null,
      variant: variant,
    );
  }
  controller.clear();
  clearAttachments();
  // User sent a message - they want to see the response, so reset scroll intent
  scrollToBottom();
}
