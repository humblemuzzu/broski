import 'package:broski/models/runtime/runtime_event.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Pi session display names per session, fed by `session-info-changed`
/// backend events.
class PiLiveSessionNameNotifier extends StateNotifier<Map<String, String>> {
  PiLiveSessionNameNotifier() : super(const {});

  void applySessionInfoChanged(RuntimeBackendEvent event) {
    final sessionId = event.sessionId;
    final payload = event.payload;
    if (sessionId == null || sessionId.isEmpty) return;
    if (payload is! Map<String, dynamic>) return;

    final name = (payload['name'] as String?)?.trim();
    if (name == null || name.isEmpty) {
      if (!state.containsKey(sessionId)) return;
      state = {...state}..remove(sessionId);
      return;
    }

    state = {...state, sessionId: name};
  }
}

final piLiveSessionNamesProvider =
    StateNotifierProvider<PiLiveSessionNameNotifier, Map<String, String>>(
      (ref) => PiLiveSessionNameNotifier(),
    );

/// Title reported live for [sessionId], or null while the bridge has not sent a
/// rename for that session.
final piLiveSessionTitleProvider = Provider.family<String?, String?>((
  ref,
  sessionId,
) {
  if (sessionId == null || sessionId.isEmpty) return null;
  return ref.watch(piLiveSessionNamesProvider)[sessionId];
});
