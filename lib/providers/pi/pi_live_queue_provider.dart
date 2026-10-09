import 'package:broski/models/pi.dart';
import 'package:broski/models/runtime/runtime_event.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Pi steering/follow-up queues per session, fed by `queue-update` backend
/// events instead of polling `pi_get_queue`.
class PiLiveQueueNotifier extends StateNotifier<Map<String, PiQueueState>> {
  PiLiveQueueNotifier() : super(const {});

  void applyQueueUpdate(RuntimeBackendEvent event) {
    final sessionId = event.sessionId;
    final payload = event.payload;
    if (sessionId == null || sessionId.isEmpty) return;
    if (payload is! Map<String, dynamic>) return;
    state = {...state, sessionId: PiQueueState.fromJson(payload)};
  }
}

final piLiveQueueProvider =
    StateNotifierProvider<PiLiveQueueNotifier, Map<String, PiQueueState>>(
      (ref) => PiLiveQueueNotifier(),
    );

/// Pending Pi messages for [sessionId]: live queue events once the session has
/// reported one, otherwise the last polled `pi_get_state` snapshot.
final piQueuePendingCountProvider = Provider.family<int, String?>((
  ref,
  sessionId,
) {
  if (sessionId != null && sessionId.isNotEmpty) {
    final live = ref.watch(piLiveQueueProvider)[sessionId];
    if (live != null) return live.total;
  }

  final cwd = ref.watch(chatSessionProvider.select((chat) => chat.piCwd));
  return ref.watch(piStateProvider(cwd)).valueOrNull?.pendingMessageCount ?? 0;
});
