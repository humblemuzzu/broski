import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/cache/cache_directories.dart';
import 'package:broski/agent/catalog/backends_controller.dart';
import 'package:broski/agent/catalog/directories_controller.dart';
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/client/agent_clock.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/socket_contract_link.dart';
import 'package:broski/agent/notify/run_completion_watcher.dart';
import 'package:broski/agent/notify/run_done_notifier.dart';
import 'package:broski/agent/notify/session_viewing.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/prompt_handoff.dart';
import 'package:broski/agent/session/session_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/app_info_provider.dart'
    show appVersionProvider;
import 'package:broski/providers/connection/link_connection_controller.dart'
    show linkConnectionControllerProvider;
import 'package:broski/providers/link/machines_provider.dart'
    show machinesProvider;
import 'package:broski/providers/service_providers.dart'
    show webSocketServiceProvider;
import 'package:flutter_riverpod/flutter_riverpod.dart';

final agentClockProvider = Provider<AgentClock>((ref) => const SystemClock());

/// The app's one contract client, over the socket the old services share.
final contractClientProvider = Provider<ContractClient>((ref) {
  final client = ContractClient(
    link: SocketContractLink(
      ref.watch(webSocketServiceProvider),
      failures: ref.watch(linkConnectionControllerProvider).sendFailures,
    ),
    info: () =>
        ClientInfo(name: 'broski-app', version: ref.read(appVersionProvider)),
    clock: ref.watch(agentClockProvider),
  );
  ref.onDispose(client.dispose);
  return client;
});

/// The machine whose bridge the contract client talks to; null when none is
/// chosen.
final agentCacheScopeProvider = Provider<String?>(
  (ref) => ref.watch(machinesProvider.select((state) => state.selectedId)),
);

/// What the phone read last from the chosen machine, for the times the link
/// is down; null while no machine is chosen.
final agentCacheProvider = Provider<AgentCache?>((ref) {
  final machine = ref.watch(agentCacheScopeProvider);
  if (machine == null) return null;
  return AgentCache(
    ref.watch(cacheDirectoriesProvider).storeFor(machine),
    clock: ref.watch(agentClockProvider),
  );
});

final contractStateProvider = StreamProvider<ContractState>((ref) async* {
  final client = ref.watch(contractClientProvider);
  yield client.state;
  yield* client.states;
});

/// Whether the phone can reach the bridge's contract now. Without it a screen
/// shows what was saved and offers nothing that changes anything.
final liveProvider = Provider<bool>(
  (ref) => ref.watch(contractStateProvider).valueOrNull is ContractReady,
);

final backendsProvider =
    StateNotifierProvider<BackendsController, BackendsState>(
      (ref) => BackendsController(
        ref.watch(contractClientProvider),
        cache: ref.watch(agentCacheProvider),
      ),
    );

/// What a backend can do, once it is listed (contract §6).
final capabilitiesProvider = Provider.family<Capabilities?, BackendId>(
  (ref, backend) => ref
      .watch(backendsProvider)
      .backends
      .where((listed) => listed.id == backend)
      .firstOrNull
      ?.capabilities,
);

final sessionListProvider = StateNotifierProvider.autoDispose
    .family<SessionListController, SessionListState, SessionListKey>(
      (ref, key) => SessionListController(
        ref.watch(contractClientProvider),
        key,
        cache: ref.watch(agentCacheProvider),
        clock: ref.watch(agentClockProvider),
      ),
    );

/// The directories a backend's sessions work in, its projects.
final directoriesProvider =
    StateNotifierProvider.family<
      DirectoriesController,
      DirectoriesState,
      BackendId
    >(
      (ref, backend) => DirectoriesController(
        ref.watch(contractClientProvider),
        backend,
        cache: ref.watch(agentCacheProvider),
      ),
    );

final promptHandoffProvider = Provider<PromptHandoff>((ref) => PromptHandoff());

/// One store per session, keyed by its ref: attached while anything watches
/// it, detached when nothing does.
final sessionProvider = StateNotifierProvider.autoDispose
    .family<SessionController, AgentSessionState, SessionRef>(
      (ref, session) => SessionController(
        client: ref.watch(contractClientProvider),
        ref: session,
        cache: ref.watch(agentCacheProvider),
        clock: ref.watch(agentClockProvider),
        handoff: ref.watch(promptHandoffProvider),
      ),
    );

final sessionViewingProvider = Provider<SessionViewing>(
  (ref) => SessionViewing(),
);

/// How a finished run is told; the app's entry point (`main.dart`) sets it.
final runDoneNotifierProvider = Provider<RunDoneNotifier>(
  (ref) => throw UnimplementedError(
    'runDoneNotifierProvider is overridden in main.dart',
  ),
);

/// Read once at start: it lives as long as the app and tells the person when
/// a run finishes in a session they are not looking at.
final runCompletionWatcherProvider = Provider<RunCompletionWatcher>((ref) {
  final watcher = RunCompletionWatcher(
    client: ref.watch(contractClientProvider),
    viewing: ref.watch(sessionViewingProvider),
    notifier: ref.watch(runDoneNotifierProvider),
    clock: ref.watch(agentClockProvider),
  );
  ref.onDispose(watcher.dispose);
  return watcher;
});
