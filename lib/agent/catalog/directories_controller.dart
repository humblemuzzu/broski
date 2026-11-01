import 'dart:async';

import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/cache/cached_kinds.dart';
import 'package:broski/agent/catalog/directory_summary.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final class DirectoriesState {
  const DirectoriesState({
    this.directories = const [],
    this.loaded = false,
    this.problem,
    this.savedAt,
  });

  final List<DirectorySummary> directories;
  final bool loaded;
  final String? problem;

  /// When the saved copy these directories come from was taken; null once
  /// the bridge has answered.
  final int? savedAt;
}

/// The directories a backend's sessions work in (its projects), read from the
/// session list (contract §11.1): the contract has no list of directories, and
/// a session is the only thing that says where work happens. The pages are
/// read newest first, up to [maxPages]; a directory whose newest session is
/// older than all of those is not listed, and the person starts a session in
/// it by typing it.
final class DirectoriesController extends StateNotifier<DirectoriesState> {
  DirectoriesController(this._client, this.backend, {AgentCache? cache})
    : _cache = cache,
      super(const DirectoriesState()) {
    _subscriptions.addAll([
      _client.states.listen(_onState),
      _client.catalog.listen(_onCatalog),
    ]);
    _onState(_client.state);
    _restoring = _restoreSaved();
  }

  static const pageSize = 200;
  static const maxPages = 10;
  static const _query = SessionQuery(archived: false);

  final ContractClient _client;
  final BackendId backend;
  final AgentCache? _cache;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  late final Future<void> _restoring;
  var _generation = 0;
  var _reads = 0;

  /// The read under way and the connection it was made on.
  ({int? generation, Future<void> done})? _reading;

  /// The saved copy first, then the bridge's answer: what to show now. It
  /// waits for the read under way rather than asking again.
  Future<DirectoriesState> load() async {
    await _restoring;
    await refresh();
    for (var reading = _reading; reading != null; reading = _reading) {
      await reading.done;
    }
    return state;
  }

  /// Reads the list again, unless a read on this connection is under way,
  /// which it joins: a screen and a reconnect asking at once cost one read.
  Future<void> refresh() {
    final generation = switch (_client.state) {
      ContractReady(:final generation) => generation,
      _ => null,
    };
    final reading = _reading;
    if (reading != null && reading.generation == generation) {
      return reading.done;
    }
    final done = _read();
    final started = (generation: generation, done: done);
    _reading = started;
    unawaited(
      done.whenComplete(() {
        if (identical(_reading, started)) _reading = null;
      }),
    );
    return done;
  }

  Future<void> _read() async {
    final read = ++_reads;
    final rows = <SessionSummary>[];
    PageCursor? cursor;
    for (var page = 0; page < maxPages; page++) {
      final outcome = await _client.listSessions(
        backend,
        _query,
        PageRequest(cursor: cursor, limit: pageSize),
      );
      if (!mounted || read != _reads) return;
      switch (outcome) {
        case Done(value: final listed):
          rows.addAll(listed.items);
          cursor = listed.nextCursor;
        case Refused() || Unreached():
          state = DirectoriesState(
            directories: state.directories,
            loaded: state.loaded,
            problem: problemOf(outcome),
            savedAt: state.savedAt,
          );
          return;
      }
      if (cursor == null) break;
    }
    final directories = directoriesOf(rows);
    state = DirectoriesState(directories: directories, loaded: true);
    unawaited(_cache?.saveDirectories(backend, directories));
  }

  Future<void> _restoreSaved() async {
    final saved = await _cache?.directories(backend);
    if (saved == null || !mounted || state.loaded) return;
    state = DirectoriesState(
      directories: saved.value,
      loaded: true,
      savedAt: saved.savedAt,
    );
  }

  void _onState(ContractState next) {
    if (next case ContractReady(
      :final generation,
    ) when generation != _generation) {
      _generation = generation;
      unawaited(refresh());
    }
  }

  void _onCatalog(CatalogMessage message) {
    if (message.backend != backend || !state.loaded) return;
    if (message.event case SessionUpdatedEvent(:final summary)) {
      if (summary.cwd == null || summary.archived) return;
      state = DirectoriesState(
        directories: withActivity(state.directories, summary),
        loaded: true,
        savedAt: state.savedAt,
      );
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
