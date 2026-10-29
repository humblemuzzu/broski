import 'dart:async';
import 'dart:typed_data';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/socket_contract_link.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/session_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/connection/bridge_status_tracker.dart';
import 'package:broski/providers/connection/link_status_mapping.dart';
import 'package:broski/services/link/machine_bundle_fetcher.dart';
import 'package:broski/services/link/pairing_input.dart';
import 'package:broski/services/websocket/link_transport.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../link/e2e/link_daemon.dart';

/// A phone paired with [LinkDaemon] over the LAN, built from the app's own
/// parts: the link connection, the transport and socket the old services
/// use, the status mapping that turns a new bridge socket into a reconnect,
/// and the contract client and session store over them.
final class E2ePhone {
  E2ePhone._(this._connection, this._socket, this.client, this.container);

  static Future<E2ePhone> pair(LinkDaemon daemon) async {
    final uri = LinkDaemon.pointAt(
      await daemon.pairingUri(),
      daemon.lanCandidate,
    );
    final pending = parsePairingInput(uri, DateTime.now().toUtc());
    if (pending == null) {
      throw StateError('the daemon offered no v2 pairing: $uri');
    }
    final bundle = await MachineBundleFetcher().fetch(pending);
    final identity = LinkIdentity.generate();
    final connection = await LinkConnection.start(
      identitySecret: identity.secret,
      endpoint: _endpoint(
        pending.machineId,
        bundle,
        identity.id,
        daemon.lanCandidate,
      ),
      pairingSecret: pending.secret,
    );
    await connection.control
        .firstWhere((message) => message['t'] == 'paired')
        .timeout(const Duration(seconds: 30));
    final socket = WebSocketService();
    await socket.connect(
      LinkTransport(
        messages: connection.bridgeMessages,
        send: connection.sendBridge,
      ),
    );
    final publisher = LinkStatusPublisher(
      publish: socket.applyTransportStatus,
      onConnected: () {},
    );
    final tracker = BridgeStatusTracker(publisher: publisher, onReset: (_) {});
    final subscriptions = [
      connection.status.listen((status) {
        publisher.add(status);
        tracker.onLinkStatus(status);
      }),
      connection.bridgeStatus.listen(tracker.onBridgeStatus),
    ];
    // The pairing connection is up before anything listened, as the app's
    // `adopt(connected: true)` knows; the statuses that follow are news.
    const connected = LinkStatus(state: LinkConnectionState.connected);
    publisher.add(connected);
    tracker.onLinkStatus(connected);
    final client = ContractClient(
      link: SocketContractLink(socket, failures: connection.sendFailures),
      info: () => const ClientInfo(name: 'broski-e2e', version: '1'),
    );
    final container = ProviderContainer(
      overrides: [contractClientProvider.overrideWithValue(client)],
    );
    return E2ePhone._(connection, socket, client, container)
      .._subscriptions.addAll(subscriptions)
      .._machine = (id: pending.machineId, bundle: bundle, device: identity.id);
  }

  final LinkConnection _connection;
  final WebSocketService _socket;
  final ContractClient client;
  final ProviderContainer container;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  late final ({String id, Uint8List bundle, String device}) _machine;

  bool get ready => client.state is ContractReady;

  /// The session's store, kept attached for as long as the phone lives.
  SessionController session(SessionRef ref) {
    container.listen(sessionProvider(ref), (_, _) {});
    return container.read(sessionProvider(ref).notifier);
  }

  AgentSessionState state(SessionRef ref) =>
      container.read(sessionProvider(ref));

  /// Dials the daemon where it now listens, as LAN discovery would tell it.
  void moveTo(String lanCandidate) => _connection.updateEndpoint(
    _endpoint(_machine.id, _machine.bundle, _machine.device, lanCandidate),
  );

  Future<void> dispose() async {
    container.dispose();
    client.dispose();
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
    _socket.dispose();
    await _connection.close();
  }
}

MachineEndpoint _endpoint(
  String machineId,
  Uint8List bundle,
  String deviceId,
  String lanCandidate,
) => MachineEndpoint(
  machineId: machineId,
  serverPublicBundle: bundle,
  deviceId: deviceId,
  lan: [lanCandidate],
);
