import 'package:broski/models/agent_type.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi/pi_live_bash_provider.dart';
import 'package:broski/providers/pi/pi_live_queue_provider.dart';
import 'package:broski/providers/pi/pi_live_session_name_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_runtime.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Routes Pi `backend_event`s to the live state the Pi UI reads. Watched once
/// from the app root; the subscription lives for the app's lifetime.
final piBackendEventListenerProvider = Provider<void>((ref) {
  final bridge = ref.watch(bridgeServiceProvider);
  final subscription = bridge.runtimeEvents.listen(
    (event) => applyPiBackendEvent(ref, event),
  );
  ref.onDispose(subscription.cancel);
});

void applyPiBackendEvent(Ref ref, RuntimeEvent event) {
  if (event is! RuntimeBackendEvent || event.backend != AgentType.pi) return;

  switch (event.kind) {
    case 'queue-update':
      ref.read(piLiveQueueProvider.notifier).applyQueueUpdate(event);
    case 'bash-output':
      ref.read(piLiveBashProvider.notifier).appendChunk(event);
    case 'thinking-level-changed':
      final level = piThinkingLevelFromBackendEvent(event);
      if (level != null) {
        ref.read(chatSessionProvider.notifier).setPiThinkingLevel(level);
      }
    case 'session-info-changed':
      ref
          .read(piLiveSessionNamesProvider.notifier)
          .applySessionInfoChanged(event);
  }
}

/// Thinking level carried by a `thinking-level-changed` backend event.
PiThinkingLevel? piThinkingLevelFromBackendEvent(RuntimeBackendEvent event) {
  final payload = event.payload;
  if (payload is! Map<String, dynamic>) return null;
  final level = payload['level'];
  if (level is! String || level.isEmpty) return null;
  return PiThinkingLevel.fromWireValue(level);
}
