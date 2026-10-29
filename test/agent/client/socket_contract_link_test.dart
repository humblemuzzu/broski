import 'dart:async';
import 'dart:convert';

import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_failure.dart';
import 'package:broski/agent/client/contract_reply.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/socket_contract_link.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/services/websocket/link_transport.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

/// The contract client over the app's real [WebSocketService]: its frames go
/// out alone and tagged with their request id, and the socket keeps answering
/// the old heartbeat beside them.
void main() {
  late StreamController<String> incoming;
  late StreamController<LinkSendFailure> failures;
  late List<({String text, String? tag})> sent;
  late WebSocketService socket;
  late ContractClient client;

  setUp(() async {
    incoming = StreamController<String>();
    failures = StreamController<LinkSendFailure>.broadcast();
    sent = [];
    socket = WebSocketService();
    await socket.connect(
      LinkTransport(
        messages: incoming.stream,
        send: (text, {tag}) => sent.add((text: text, tag: tag)),
      ),
    );
    client = ContractClient(
      link: SocketContractLink(socket, failures: failures.stream),
      info: () => const ClientInfo(name: 'broski-test', version: '1'),
    );
    socket.applyTransportStatus(ConnectionStatus.connected);
    await pumpEventQueue();
  });

  tearDown(() async {
    client.dispose();
    socket.dispose();
    await incoming.close();
    await failures.close();
  });

  Map<String, Object?> lastFrame() => switch (jsonDecode(sent.last.text)) {
    final Map<String, Object?> frame => frame,
    _ => throw StateError('not a JSON object'),
  };

  String lastRequestId() => switch (lastFrame()['message']) {
    {'requestId': final String requestId} => requestId,
    _ => throw StateError('no request id'),
  };

  test('a contract frame goes out alone, tagged with its request id', () {
    final frame = lastFrame();
    expect(frame['type'], 'contract');
    expect(frame.keys, unorderedEquals(['type', 'message']));
    expect(sent.last.tag, lastRequestId());
  });

  test('a refusal by the link fails the request it carried', () async {
    incoming.add(
      jsonEncode({
        'type': 'contract',
        'message': HelloResponse(
          requestId: lastRequestId(),
          protocol: const ProtocolVersion(
            major: contractProtocolMajor,
            minor: 0,
          ),
          bridgeVersion: '1',
        ).toJson(),
      }),
    );
    await pumpEventQueue();
    expect(client.state, isA<ContractReady>());
    final pending = client.request<BackendsListResponse>(
      (requestId) => BackendsListRequest(requestId: requestId),
    );
    await pumpEventQueue();
    failures.add(
      LinkSendFailure(
        reason: LinkSendFailureReason.tooLarge,
        stream: 1,
        bytes: 1,
        tag: lastRequestId(),
      ),
    );
    expect(
      await pending,
      isA<Failed<BackendsListResponse>>().having(
        (reply) => reply.failure,
        'failure',
        isA<LinkRefusal>(),
      ),
    );
  });

  test('the old heartbeat is still answered beside the contract', () async {
    incoming.add(
      jsonEncode({
        'type': 'ping',
        'data': {'id': 'p1', 'sentAt': 5},
      }),
    );
    await pumpEventQueue();
    expect(lastFrame(), {'type': 'pong', 'id': 'p1', 'sentAt': 5});
  });

  test('losing the socket takes the contract offline', () async {
    socket.applyTransportStatus(ConnectionStatus.connecting);
    await pumpEventQueue();
    expect(client.state, isA<ContractOffline>());
  });
}
