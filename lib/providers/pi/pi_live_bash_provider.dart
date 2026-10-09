import 'package:broski/models/runtime/runtime_event.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Chunks of stdout streamed by `pi_execute_bash`, per session, while the
/// caller waits for the `pi_bash_result` reply.
class PiLiveBashNotifier extends StateNotifier<Map<String, String>> {
  PiLiveBashNotifier() : super(const {});

  static const int maxCharsPerSession = 64 * 1024;

  void clearSession(String sessionId) {
    if (sessionId.isEmpty || !state.containsKey(sessionId)) return;
    final next = Map<String, String>.of(state)..remove(sessionId);
    state = next;
  }

  void appendChunk(RuntimeBackendEvent event) {
    final sessionId = event.sessionId;
    final payload = event.payload;
    if (sessionId == null || sessionId.isEmpty) return;
    if (payload is! Map<String, dynamic>) return;
    final content = payload['content'];
    if (content is! String || content.isEmpty) return;

    final next = (state[sessionId] ?? '') + content;
    state = {
      ...state,
      sessionId: next.length > maxCharsPerSession
          ? next.substring(next.length - maxCharsPerSession)
          : next,
    };
  }
}

final piLiveBashProvider =
    StateNotifierProvider<PiLiveBashNotifier, Map<String, String>>(
      (ref) => PiLiveBashNotifier(),
    );
