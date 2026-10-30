import 'dart:async';

import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/cache/cached_kinds.dart';
import 'package:broski/agent/catalog/session_rows.dart';
import 'package:broski/agent/client/agent_clock.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// One list of sessions: a backend and a query.
typedef SessionListKey = ({BackendId backend, SessionQuery query});

final class SessionListState {
  const SessionListState({
    this.rows = const [],
    this.nextCursor,
    this.loaded = false,
    this.loading = false,
    this.problem,
    this.savedAt,
  });

  final List<SessionSummary> rows;
  final PageCursor? nextCursor;
  final bool loaded;
  final bool loading;
  final String? problem;

  /// When the saved copy these rows come from was taken; null once the bridge
  /// has answered. Until then the rows are what the phone last saw.
  final int? savedAt;

  bool get complete => loaded && nextCursor == null;
}

/// A paged session list (contract §11.1): pages newest first, read again on
/// every new connection, and kept current by the catalog's row news without
/// re-reading the list.
final class SessionListController extends StateNotifier<SessionListState> {
  SessionListController(
    this._client,
    this.key, {
    AgentCache? cache,
    AgentClock clock = const SystemClock(),
  }) : _cache = cache,
       _clock = clock,
       super(const SessionListState()) {
    _subscriptions.addAll([
      _client.states.listen(_onState),
      _client.catalog.listen(_onCatalog),
    ]);
    _onState(_client.state);
    unawaited(_restoreSaved());
  }

  static const pageSize = 50;
  static const saveDelay = Duration(seconds: 2);

  final ContractClient _client;
  final SessionListKey key;
  final AgentCache? _cache;
  final AgentClock _clock;
  void Function()? _cancelSave;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  var _generation = 0;
  var _reads = 0;

  Future<void> refresh() => _read(cursor: null);

  Future<void> loadMore() async {
    final cursor = state.nextCursor;
    if (cursor == null || state.loading) return;
    await _read(cursor: cursor);
  }

  /// Takes a row out at once after a delete the backend accepted.
  void removeRow(SessionRef session) => _setRows([
    for (final row in state.rows)
      if (row.session != session) row,
  ]);

  Future<void> _read({required PageCursor? cursor}) async {
    final read = ++_reads;
    state = SessionListState(
      rows: state.rows,
      nextCursor: state.nextCursor,
      loaded: state.loaded,
      loading: true,
      savedAt: state.savedAt,
    );
    final outcome = await _client.listSessions(
      key.backend,
      key.query,
      PageRequest(cursor: cursor, limit: pageSize),
    );
    if (!mounted || read != _reads) return;
    state = switch (outcome) {
      Done(value: final page) => SessionListState(
        rows: cursor == null ? page.items : withPage(state.rows, page.items),
        nextCursor: page.nextCursor,
        loaded: true,
      ),
      Refused() || Unreached() => SessionListState(
        rows: state.rows,
        nextCursor: state.nextCursor,
        loaded: state.loaded,
        problem: problemOf(outcome),
        savedAt: state.savedAt,
      ),
    };
    if (cursor == null && outcome is Done) _save();
  }

  Future<void> _restoreSaved() async {
    final saved = await _cache?.sessions(key.backend, key.query);
    if (saved == null || !mounted || state.loaded) return;
    state = SessionListState(
      rows: saved.value,
      loaded: true,
      loading: state.loading,
      savedAt: saved.savedAt,
    );
  }

  void _save() {
    _cancelSave?.call();
    _cancelSave = null;
    unawaited(_cache?.saveSessions(key.backend, key.query, state.rows));
  }

  void _saveLater() {
    if (_cache == null || state.savedAt != null) return;
    _cancelSave?.call();
    _cancelSave = _clock.after(saveDelay, _save);
  }

  void _setRows(List<SessionSummary> rows) => state = SessionListState(
    rows: rows,
    nextCursor: state.nextCursor,
    loaded: state.loaded,
    loading: state.loading,
    problem: state.problem,
    savedAt: state.savedAt,
  );

  void _onState(ContractState next) {
    if (next case ContractReady(
      :final generation,
    ) when generation != _generation) {
      _generation = generation;
      unawaited(refresh());
    }
  }

  void _onCatalog(CatalogMessage message) {
    if (message.backend != key.backend) return;
    switch (message.event) {
      case SessionUpdatedEvent(:final summary):
        final held = state.rows.any((row) => row.session == summary.session);
        if (belongsTo(summary, key.query, held: held)) {
          _setRows(withRow(state.rows, summary));
          _saveLater();
        } else if (held) {
          removeRow(summary.session);
          _saveLater();
        }
      case SessionRemovedEvent(:final session):
        removeRow(session);
        _saveLater();
      default:
        return;
    }
  }

  @override
  void dispose() {
    _cancelSave?.call();
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    super.dispose();
  }
}
