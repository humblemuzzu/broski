import 'dart:async';

import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/catalog_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The backends the bridge serves now, what each can do, and how each is.
final class BackendsState {
  const BackendsState({
    this.backends = const [],
    this.statuses = const {},
    this.loaded = false,
    this.problem,
  });

  final List<BackendDescriptor> backends;
  final Map<BackendId, BackendStatus> statuses;
  final bool loaded;
  final String? problem;
}

/// Lists the backends on every new connection, and again when one the app
/// has not listed reports its status: it just landed (core README §15).
final class BackendsController extends StateNotifier<BackendsState> {
  BackendsController(this._client) : super(const BackendsState()) {
    _subscriptions.addAll([
      _client.states.listen(_onState),
      _client.catalog.listen(_onCatalog),
    ]);
    _onState(_client.state);
  }

  final ContractClient _client;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  var _generation = 0;
  var _lists = 0;

  Future<void> refresh() async {
    final list = ++_lists;
    final outcome = await _client.listBackends();
    if (!mounted || list != _lists) return;
    switch (outcome) {
      case Done(value: final backends):
        state = BackendsState(
          backends: backends,
          statuses: state.statuses,
          loaded: true,
        );
        for (final backend in backends) {
          unawaited(_refreshStatus(backend.id));
        }
      case Refused() || Unreached():
        state = BackendsState(
          backends: state.backends,
          statuses: state.statuses,
          loaded: state.loaded,
          problem: problemOf(outcome),
        );
    }
  }

  Future<void> _refreshStatus(BackendId backend) async {
    final outcome = await _client.backendStatus(backend);
    if (!mounted) return;
    if (outcome case Done(value: final status)) _setStatus(backend, status);
  }

  void _setStatus(BackendId backend, BackendStatus status) =>
      state = BackendsState(
        backends: state.backends,
        statuses: {...state.statuses, backend: status},
        loaded: state.loaded,
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
    if (message.event case StatusChangedEvent(:final status)) {
      final listed = state.backends.any((known) => known.id == message.backend);
      if (listed) {
        _setStatus(message.backend, status);
      } else {
        unawaited(refresh());
      }
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
