import 'package:broski/agent/catalog/backends_controller.dart';
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/client/agent_clock.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/socket_contract_link.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/prompt_handoff.dart';
import 'package:broski/agent/session/session_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/app_info_provider.dart'
    show appVersionProvider;
import 'package:broski/providers/connection/link_connection_controller.dart'
    show linkConnectionControllerProvider;
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

final contractStateProvider = StreamProvider<ContractState>((ref) async* {
  final client = ref.watch(contractClientProvider);
  yield client.state;
  yield* client.states;
});

final backendsProvider =
    StateNotifierProvider<BackendsController, BackendsState>(
      (ref) => BackendsController(ref.watch(contractClientProvider)),
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
      (ref, key) =>
          SessionListController(ref.watch(contractClientProvider), key),
    );

final promptHandoffProvider = Provider<PromptHandoff>((ref) => PromptHandoff());

/// One store per session, keyed by its ref: attached while anything watches
/// it, detached when nothing does.
final sessionProvider = StateNotifierProvider.autoDispose
    .family<SessionController, AgentSessionState, SessionRef>(
      (ref, session) => SessionController(
        client: ref.watch(contractClientProvider),
        ref: session,
        clock: ref.watch(agentClockProvider),
        handoff: ref.watch(promptHandoffProvider),
      ),
    );
