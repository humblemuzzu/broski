import 'dart:async';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/catalog_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A backend's list for one directory; some backends answer per directory
/// (OpenCode agents, contract §11.5).
typedef CatalogKey = ({BackendId backend, String? cwd});

/// What `commands.list` is asked for: a directory and, once there is one,
/// the session.
typedef CommandsKey = ({BackendId backend, String? cwd, SessionRef? session});

final modelsProvider = FutureProvider.autoDispose
    .family<Outcome<List<ModelSummary>>, CatalogKey>((ref, key) {
      final client = ref.watch(contractClientProvider);
      _readAgainWhenStale(ref, client, key.backend, CatalogScope.models);
      return client.listModels(key.backend, cwd: key.cwd);
    });

final modesProvider = FutureProvider.autoDispose
    .family<Outcome<List<ModeAxis>>, CatalogKey>((ref, key) {
      final client = ref.watch(contractClientProvider);
      _readAgainWhenStale(ref, client, key.backend, CatalogScope.modes);
      return client.listModes(key.backend, cwd: key.cwd);
    });

final commandsProvider = FutureProvider.autoDispose
    .family<Outcome<List<CommandSummary>>, CommandsKey>((ref, key) {
      final client = ref.watch(contractClientProvider);
      _readAgainWhenStale(ref, client, key.backend, CatalogScope.commands);
      return client.listCommands(
        key.backend,
        cwd: key.cwd,
        session: key.session,
      );
    });

/// Reads the list again when the backend says it is stale
/// (`catalog_invalidated`), and on every new connection.
void _readAgainWhenStale(
  Ref ref,
  ContractClient client,
  BackendId backend,
  CatalogScope scope,
) {
  final generation = switch (client.state) {
    ContractReady(:final generation) => generation,
    _ => 0,
  };
  final subscriptions = [
    client.catalog.listen((message) {
      final stale = switch (message.event) {
        CatalogInvalidatedEvent(scope: final invalid) => invalid == scope,
        _ => false,
      };
      if (stale && message.backend == backend) ref.invalidateSelf();
    }),
    client.states.listen((state) {
      if (state case ContractReady(
        generation: final next,
      ) when next != generation) {
        ref.invalidateSelf();
      }
    }),
  ];
  ref.onDispose(() {
    for (final subscription in subscriptions) {
      unawaited(subscription.cancel());
    }
  });
}
