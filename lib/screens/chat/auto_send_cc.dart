import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/chat_provider.dart';
import '../../providers/claude_code_provider.dart';
import '../../providers/claude_code_variant_provider.dart';
import '../../providers/service_providers.dart';

/// Auto-send a pending CC message when the turn completes.
/// Uses the same CC send flow as _sendMessage (config, model, sessionId, etc.)
/// Extracted from `_ChatScreenState._autoSendPendingCCMessage`.
void autoSendPendingCCMessage({
  required WidgetRef ref,
  required bool isClaudeCode,
  required bool Function() isMounted,
  required String? ccSessionCwd,
  required String? ccSessionModel,
  required String? ccDraftCwd,
  required String? ccDraftModel,
  required void Function() resetScrollAndScrollToBottom,
}) {
  if (!isClaudeCode || !isMounted()) return;
  final chat = ref.read(chatSessionProvider.notifier);
  final chatState = ref.read(chatSessionProvider);
  final pendingText = chatState.pendingCCMessage;
  final pendingAttachments = chatState.pendingCCAttachments;
  if (pendingText == null || pendingText.isEmpty) return;
  // Clear pending state first to prevent re-entry
  chat.clearPendingCCMessage();
  // Read all the same config values that _sendMessage reads for CC
  final bridge = ref.read(bridgeServiceProvider);
  final ccConfig = ref.read(ccConfigProvider).valueOrNull;
  final cwd = chatState.ccCwd ?? ccSessionCwd ?? ccDraftCwd;
  final model =
      ccConfig?.model ??
      chatState.ccModel ??
      chatState.ccInit?.model ??
      ccSessionModel ??
      ccDraftModel;
  final activeSubagent = ccConfig?.activeSubagent;
  final hasAttachments =
      pendingAttachments != null && pendingAttachments.isNotEmpty;
  // Build display message with file attachments
  String displayText = pendingText;
  if (hasAttachments) {
    final attachmentLabels = <String>[];
    int imageCount = 0;
    for (final f in pendingAttachments) {
      if (f.isImage) {
        imageCount++;
        attachmentLabels.add('[Image $imageCount]');
      } else {
        attachmentLabels.add(f.displayPath);
      }
    }
    if (attachmentLabels.isNotEmpty) {
      displayText = '$pendingText\n${attachmentLabels.join(' ')}';
    }
  }
  chat.appendUserMessage(displayText);
  chat.setCCStreaming(true);
  final ccVariant = ref.read(claudeCodeVariantProvider).selectedVariant;
  bridge.ccChat(
    sessionId: chatState.ccSessionId,
    prompt: pendingText,
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
    outputFormat: ccConfig?.outputFormat,
    sandbox: ccConfig?.sandbox,
    enableAgentTeams: ccConfig?.enableAgentTeams,
    enableClaudeAiMcpServers: ccConfig?.enableClaudeAiMcpServers,
    fileAttachments: hasAttachments ? pendingAttachments : null,
  );
  resetScrollAndScrollToBottom();
}
