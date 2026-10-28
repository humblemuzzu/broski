import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/runtime/runtime.dart';
import 'package:broski/providers/pi_durable/pi_durable_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// How long durable session-change events are coalesced before the list is
/// refetched.
const Duration piDurableSessionsRefreshDebounce = Duration(milliseconds: 500);

/// Whether [event] can change what `unified_list_sessions` reports for a
/// durable session (title, updatedAt, streaming). The bridge sends no session
/// row for pi-durable, so the refresh is derived from its event stream.
bool piDurableEventChangesSessions(RuntimeEvent event) {
  if (event.backend != AgentType.piDurable) return false;
  switch (event) {
    case RuntimeAgentFinishedEvent():
    case RuntimeSessionStateChangedEvent():
      return true;
    case RuntimeBackendEvent():
      return event.kind == 'submission';
    default:
      return false;
  }
}

/// Turns the pi-durable events that change the session list into at most one
/// refetch per burst, so a turn does not fire a list request per event.
class PiDurableSessionsRefresher {
  PiDurableSessionsRefresher({
    required void Function() onRefresh,
    Duration debounce = piDurableSessionsRefreshDebounce,
  }) : _onRefresh = onRefresh,
       _debounce = debounce;

  final void Function() _onRefresh;
  final Duration _debounce;
  Timer? _timer;

  void schedule(RuntimeEvent event) {
    if (!piDurableEventChangesSessions(event)) return;
    _timer?.cancel();
    _timer = Timer(_debounce, _onRefresh);
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
  }
}

/// A refresher bound to [piDurableSessionsProvider] for a notifier that already
/// owns runtime subscriptions.
PiDurableSessionsRefresher piDurableSessionsRefresher(Ref ref) {
  return PiDurableSessionsRefresher(
    onRefresh: () => ref.invalidate(piDurableSessionsProvider),
  );
}
