import 'package:broski/models/codex.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/codex_settings_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Auto-send the first queued Codex message when the turn completes.
///
/// Pops the first message from `cxQueuedMessages`, appends it as a user
/// message, and sends it via `cxChat` with the same config as a normal send.
///
/// Mirrors `auto_send_cc.dart` for Claude Code.
void autoSendQueuedCxMessage({
  required WidgetRef ref,
  required bool isCodex,
  required bool Function() isMounted,
  required String? cxThreadCwd,
  required String? cxDraftCwd,
  required void Function() resetScrollAndScrollToBottom,
}) {
  if (!isCodex || !isMounted()) return;
  final chat = ref.read(chatSessionProvider.notifier);
  final chatState = ref.read(chatSessionProvider);
  final queue = chatState.cxQueuedMessages;
  if (queue.isEmpty) return;

  // Pop first message
  final nextMessage = queue.first;
  final remaining = queue.length > 1 ? queue.sublist(1) : const <String>[];
  chat.clearCodexQueue();
  if (remaining.isNotEmpty) {
    // Re-add remaining messages
    for (final msg in remaining) {
      chat.queueCodexMessage(msg);
    }
  }

  // Send as a full new turn (same as the normal Codex send path)
  final bridge = ref.read(bridgeServiceProvider);
  final codexSettings = ref.read(codexSettingsProvider);
  final cwd = chatState.cxCwd ?? cxThreadCwd ?? cxDraftCwd;
  if (cwd == null || cwd.isEmpty) return;

  chat.appendUserMessage(nextMessage);
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

  bridge.cxChat(
    threadId: chatState.cxThreadId,
    cwd: cwd,
    prompt: nextMessage,
    model: chatState.cxModel,
    effort: codexSettings.reasoningEffort.wireValue,
    summary: codexSettings.reasoningSummary.wireValue,
    approvalPolicy: codexSettings.approvalPolicy.wireValue,
    sandbox: codexSettings.sandboxMode.threadWireValue,
    sandboxPolicy: sandboxPolicy,
    config: config,
    collaborationMode: codexSettings.collaborationMode.wireValue,
    personality: codexSettings.personality.wireValue,
    serviceTier: codexSettings.serviceTier.wireValue,
  );

  resetScrollAndScrollToBottom();
}
