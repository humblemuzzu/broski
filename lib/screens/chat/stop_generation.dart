import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Stop AI generation for all backends.
///
/// The abort goes to the bridge, and the run ends on this phone at once instead of when the bridge
/// answers: with the bridge unreachable the abort reply and the events that would end the run never
/// come, and Stop must still leave the running state. The next resync shows what the Mac recorded.
/// Extracted from `_ChatScreenState._stopGeneration`.
void stopGeneration({
  required WidgetRef ref,
  required bool isClaudeCode,
  required bool isCodex,
  required String sessionId,
  required String projectPath,
}) {
  final bridge = ref.read(bridgeServiceProvider);
  final notifier = ref.read(chatSessionProvider.notifier);
  final chatState = ref.read(chatSessionProvider);
  if (isClaudeCode) {
    final sid = chatState.ccSessionId;
    if (sid != null && sid.isNotEmpty) {
      bridge.ccAbort(sid);
    }
  } else if (isCodex) {
    final tid = chatState.cxThreadId;
    if (tid != null && tid.isNotEmpty) {
      bridge.cxAbort(threadId: tid);
    }
  } else {
    bridge.abortSession(sessionId, projectPath: projectPath);
  }
  notifier.cancelRunLocally();
}
