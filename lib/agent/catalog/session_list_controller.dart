import 'dart:async';

import 'package:broski/agent/catalog/session_rows.dart';
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
  });

  final List<SessionSummary> rows;
  final PageCursor? nextCursor;
  final bool loaded;
  final bool loading;
  final String? problem;

  bool get complete => loaded && nextCursor == null;
}

/// A paged session list (contract §11.1): pages newest first, read again on
/// every new connection, and kept current by the catalog's row news without
/// re-reading the list.
final class SessionListController extends StateNotifier<SessionListState> {
  SessionListController(this._client, this.key)
    : super(const SessionListState()) {
    _subscriptions.addAll([
      _client.states.listen(_onState),
      _client.catalog.listen(_onCatalog),
    ]);
    _onState(_client.state);
  }

  static const pageSize = 50;

  final ContractClient _client;
  final SessionListKey key;
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
      ),
    };
  }

  void _setRows(List<SessionSummary> rows) => state = SessionListState(
    rows: rows,
    nextCursor: state.nextCursor,
    loaded: state.loaded,
    loading: state.loading,
    problem: state.problem,
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
        } else if (held) {
          removeRow(summary.session);
        }
      case SessionRemovedEvent(:final session):
        removeRow(session);
      default:
        return;
    }
  }

  @override
  void dispose() {
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    super.dispose();
  }
}
