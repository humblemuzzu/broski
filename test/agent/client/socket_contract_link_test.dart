import 'dart:async';
import 'dart:convert';

import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_failure.dart';
import 'package:broski/agent/client/contract_reply.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/frame_lane.dart';
import 'package:broski/agent/client/socket_contract_link.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/services/websocket/link_transport.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_test/flutter_test.dart';

const _session = SessionRef(backend: BackendId.pi, sessionId: 's');

String _frame(Map<String, Object?> message) =>
    jsonEncode({'type': 'contract', 'message': message});

/// A transcript answer well past the size a frame is read on the UI isolate.
String _largeAnswer(String requestId) => _frame({
  'type': 'transcript.read.result',
  'requestId': requestId,
  'result': {
    'status': 'accepted',
    'page': {
      'items': [
        {
          'kind': 'block',
          'id': 'b',
          'at': 1,
          'messageId': 'm',
          'block': 'text',
          'text': 'x' * (2 * frameOffloadChars),
        },
      ],
      'idStability': 'stable',
    },
  },
});

/// The contract client over the app's real [WebSocketService]: its frames go
/// out alone and tagged with their request id, the socket keeps answering the
/// old heartbeat beside them, and the answers come back in the order the
/// bridge sent them, large ones read off the UI isolate included.
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

  Future<void> becomeReady() async {
    incoming.add(
      _frame(
        HelloResponse(
          requestId: lastRequestId(),
          protocol: const ProtocolVersion(
            major: contractProtocolMajor,
            minor: 0,
          ),
          bridgeVersion: '1',
        ).toJson(),
      ),
    );
    await pumpEventQueue();
    expect(client.state, isA<ContractReady>());
  }

  Future<ContractReply<R>> detach<R extends ServerMessage>() =>
      client.request<R>(
        (requestId) =>
            SessionDetachRequest(requestId: requestId, session: _session),
      );

  test('a contract frame goes out alone, tagged with its request id', () {
    final frame = lastFrame();
    expect(frame['type'], 'contract');
    expect(frame.keys, unorderedEquals(['type', 'message']));
    expect(sent.last.tag, lastRequestId());
  });

  test('a refusal by the link fails the request it carried', () async {
    await becomeReady();
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

  test('answers come back in the order the bridge sent them, a large one '
      'between small ones included', () async {
    await becomeReady();
    final first = detach<SessionDetachResponse>();
    final large = client.request<TranscriptReadResponse>(
      (requestId) => TranscriptReadRequest(
        requestId: requestId,
        session: _session,
        page: const PageRequest(limit: 5),
      ),
    );
    final last = detach<SessionDetachResponse>();
    await pumpEventQueue();
    final ids = [
      for (final request in sent.skip(1))
        switch (jsonDecode(request.text)) {
          {'message': {'requestId': final String id}} => id,
          _ => throw StateError('no request id'),
        },
    ];
    incoming.add(_frame(SessionDetachResponse(requestId: ids[0]).toJson()));
    incoming.add(_largeAnswer(ids[1]));
    incoming.add(_frame(SessionDetachResponse(requestId: ids[2]).toJson()));
    final arrivals = [
      (await first as Answered<SessionDetachResponse>).arrival,
      (await large as Answered<TranscriptReadResponse>).arrival,
      (await last as Answered<SessionDetachResponse>).arrival,
    ];
    expect(arrivals, [arrivals[0], arrivals[0] + 1, arrivals[0] + 2]);
  });

  test('a large answer that does not decode fails its own request, and the '
      'one behind it is answered', () async {
    await becomeReady();
    final bad = client.request<TranscriptReadResponse>(
      (requestId) => TranscriptReadRequest(
        requestId: requestId,
        session: _session,
        page: const PageRequest(limit: 5),
      ),
    );
    final good = detach<SessionDetachResponse>();
    await pumpEventQueue();
    final ids = [
      for (final request in sent.skip(1))
        switch (jsonDecode(request.text)) {
          {'message': {'requestId': final String id}} => id,
          _ => throw StateError('no request id'),
        },
    ];
    incoming.add(
      _frame({
        'type': 'transcript.read.result',
        'requestId': ids[0],
        'result': {'status': 'accepted', 'blob': 'z' * (2 * frameOffloadChars)},
      }),
    );
    incoming.add(_frame(SessionDetachResponse(requestId: ids[1]).toJson()));
    expect(
      await bad,
      isA<Failed<TranscriptReadResponse>>().having(
        (reply) => reply.failure,
        'failure',
        isA<MalformedAnswer>(),
      ),
    );
    expect(await good, isA<Answered<SessionDetachResponse>>());
  });

  test('the old services see the old protocol\'s frames and none of the '
      'contract\'s', () async {
    await becomeReady();
    final seen = <Map<String, dynamic>>[];
    final subscription = socket.messages.listen(seen.add);
    incoming.add(jsonEncode({'type': 'error', 'message': 'an old error'}));
    incoming.add(
      _frame(
        const EventMessage(
          envelope: EventEnvelope(
            session: _session,
            seq: 1,
            at: 1,
            event: NoticeEvent(level: NoticeLevel.info, text: 'n'),
          ),
        ).toJson(),
      ),
    );
    incoming.add(_largeAnswer('nobody'));
    await pumpEventQueue();
    await subscription.cancel();
    expect(seen.map((frame) => frame['type']), ['error']);
  });

  test('a contract frame that does not begin as the core\'s do is reported '
      'against its request, not read', () async {
    await becomeReady();
    final pending = detach<SessionDetachResponse>();
    await pumpEventQueue();
    incoming.add(
      jsonEncode({
        'message': SessionDetachResponse(requestId: lastRequestId()).toJson(),
        'type': 'contract',
      }),
    );
    expect(
      await pending,
      isA<Failed<SessionDetachResponse>>().having(
        (reply) => reply.failure,
        'failure',
        isA<MalformedAnswer>(),
      ),
    );
  });

  test('a client let go gives the socket its contract frames back', () async {
    await becomeReady();
    client.dispose();
    final seen = <Map<String, dynamic>>[];
    final subscription = socket.messages.listen(seen.add);
    incoming.add(
      _frame(const SessionDetachResponse(requestId: 'late').toJson()),
    );
    await pumpEventQueue();
    await subscription.cancel();
    expect(seen.map((frame) => frame['type']), ['contract']);
  });

  test('losing the socket takes the contract offline', () async {
    socket.applyTransportStatus(ConnectionStatus.connecting);
    await pumpEventQueue();
    expect(client.state, isA<ContractOffline>());
  });
}
