import 'package:broski/models/agent.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/claude_code_variant_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
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

/// The subagent an `@name` mention at the start of a word names, if any.
String? _mentionedAgent(String text, List<Agent> agents) {
  final agentMatch = RegExp(r'@(\w+)(?:\s|$)').firstMatch(text);
  if (agentMatch == null) return null;
  final mentioned = agentMatch.group(1)?.toLowerCase();
  for (final agent in agents) {
    if (agent.name.toLowerCase() == mentioned) return agent.name;
  }
  return null;
}

/// Sends a chat message to Claude Code.
void sendMessage({
  required BuildContext context,
  required WidgetRef ref,
  required BridgeConnectionState connection,
  required ChatSessionState chatState,
  required TextEditingController controller,
  required List<FileAttachment> attachedFiles,
  required String? selectedAgent,
  required List<Agent> agents,
  ClaudeCodeSession? ccSession,
  String? ccDraftCwd,
  String? ccDraftModel,
  String? ccResumeSessionAtMessageId,
  required VoidCallback clearAttachments,
  required VoidCallback scrollToBottom,
  required VoidCallback onCcResumeIdCleared,
  required bool Function() isMounted,
}) {
  final text = controller.text.trim();
  final hasAttachments = attachedFiles.isNotEmpty;
  if (text.isEmpty && !hasAttachments) return;
  if (!connection.isConnected) return;

  final chat = ref.read(chatSessionProvider.notifier);
  if (chatState.ccIsStreaming) {
    // CC SDK single-message mode doesn't support mid-turn queuing.
    // Queue the message locally and auto-send when the turn completes.
    chat.setPendingCCMessage(
      text,
      attachments: hasAttachments ? attachedFiles.toList() : null,
    );
    controller.clear();
    clearAttachments();
    return;
  }

  final bridge = ref.read(bridgeServiceProvider);
  final ccConfig = ref.read(ccConfigProvider).valueOrNull;
  final cwd = chatState.ccCwd ?? ccSession?.cwd ?? ccDraftCwd;
  final model =
      ccConfig?.model ??
      chatState.ccModel ??
      chatState.ccInit?.model ??
      ccSession?.model ??
      ccDraftModel;
  final activeSubagent =
      _mentionedAgent(text, agents) ??
      selectedAgent ??
      ccConfig?.activeSubagent;
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
}
