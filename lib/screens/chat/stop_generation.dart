import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/chat_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/pi_provider.dart';

/// Stop AI generation for all backends.
/// Sends abort to bridge and clears local streaming states.
/// Extracted from `_ChatScreenState._stopGeneration`.
void stopGeneration({
  required WidgetRef ref,
  required bool isClaudeCode,
  required bool isCodex,
  required bool isPi,
  required String sessionId,
  required String projectPath,
}) {
  final bridge = ref.read(bridgeServiceProvider);
  final notifier = ref.read(chatSessionProvider.notifier);
  if (isClaudeCode) {
    final chatState = ref.read(chatSessionProvider);
    final sid = chatState.ccSessionId;
    if (sid != null && sid.isNotEmpty) {
      bridge.ccAbort(sid);
    }
    notifier.setCCStreaming(false);
  } else if (isCodex) {
    final chatState = ref.read(chatSessionProvider);
    final tid = chatState.cxThreadId;
    if (tid != null && tid.isNotEmpty) {
      bridge.cxAbort(threadId: tid);
    }
    notifier.setCodexStreaming(false);
  } else if (isPi) {
    final chatState = ref.read(chatSessionProvider);
    final piBridge = ref.read(piBridgeServiceProvider);
    piBridge.abort(projectPath: chatState.piCwd);
    notifier.setPiStreaming(false);
  } else {
    // OpenCode - send abort and clear all streaming states
    bridge.abortSession(sessionId, projectPath: projectPath);
    notifier.markAllStreamingComplete();
  }
}
