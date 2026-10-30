import 'dart:async';

import 'package:broski/agent/client/agent_clock.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/notify/run_done_notifier.dart';
import 'package:broski/agent/notify/session_viewing.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/widgets.dart';

/// Tells the person when a session finishes a run while they are elsewhere.
///
/// It reads the catalog, which every phone that said `hello` receives for
/// every session, so a session nobody is attached to is covered. A row going
/// from busy (a run, or an ask waiting inside one) to idle is one finished
/// run; a session on screen with the app in front is being watched, and says
/// nothing.
final class RunCompletionWatcher {
  RunCompletionWatcher({
    required ContractClient client,
    required SessionViewing viewing,
    required RunDoneNotifier notifier,
    required AgentClock clock,
    bool Function()? appInForeground,
  }) : _viewing = viewing,
       _notifier = notifier,
       _clock = clock,
       _appInForeground = appInForeground ?? _lifecycleInForeground {
    _subscription = client.catalog.listen(_onCatalog);
  }

  final SessionViewing _viewing;
  final RunDoneNotifier _notifier;
  final AgentClock _clock;
  final bool Function() _appInForeground;
  late final StreamSubscription<CatalogMessage> _subscription;
  final Map<SessionRef, DateTime> _busySince = {};

  static bool _lifecycleInForeground() {
    final lifecycle = WidgetsBinding.instance.lifecycleState;
    return lifecycle == null || lifecycle == AppLifecycleState.resumed;
  }

  void _onCatalog(CatalogMessage message) {
    switch (message.event) {
      case SessionUpdatedEvent(:final summary):
        _onRow(summary);
      case SessionRemovedEvent(:final session):
        _busySince.remove(session);
      default:
        return;
    }
  }

  void _onRow(SessionSummary row) {
    final busy =
        row.status == SessionStatus.running ||
        row.status == SessionStatus.waitingForUser;
    if (busy) {
      _busySince.putIfAbsent(row.session, _clock.now);
      return;
    }
    final since = _busySince.remove(row.session);
    if (since == null || row.status != SessionStatus.idle) return;
    final watching = _appInForeground() && _viewing.isViewing(row.session);
    if (watching) return;
    _notifier.runDone(
      RunDone(
        session: row.session,
        title: row.title?.text ?? 'Session',
        project: _projectName(row.cwd),
        duration: _clock.now().difference(since),
      ),
    );
  }

  static String _projectName(String? cwd) {
    final segments = cwd?.split('/').where((part) => part.isNotEmpty);
    return segments == null || segments.isEmpty ? 'Session' : segments.last;
  }

  void dispose() => unawaited(_subscription.cancel());
}
