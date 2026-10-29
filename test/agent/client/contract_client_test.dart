import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_failure.dart';
import 'package:broski/agent/client/contract_problem.dart';
import 'package:broski/agent/client/contract_reply.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/catalog_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_contract_link.dart';
import '../support/manual_clock.dart';

const _info = ClientInfo(name: 'broski-test', version: '1.0.0');

void main() {
  late FakeContractLink link;
  late ManualClock clock;
  late ContractClient client;

  setUp(() {
    link = FakeContractLink();
    clock = ManualClock();
    client = ContractClient(link: link, info: () => _info, clock: clock);
  });

  tearDown(() => client.dispose());

  Future<ContractReply<BackendsListResponse>> listBackends() =>
      client.request<BackendsListResponse>(
        (requestId) => BackendsListRequest(requestId: requestId),
      );

  BackendsListResponse backendsAnswer(String requestId) =>
      BackendsListResponse(requestId: requestId, backends: const []);

  group('hello', () {
    test('goes first, and a request waits until it is answered', () async {
      expect(link.sent.single, isA<HelloRequest>());
      final hello = link.last<HelloRequest>();
      expect(hello.protocol.major, contractProtocolMajor);
      expect(hello.client, _info);
      final pending = listBackends();
      await pumpEventQueue();
      expect(link.sent, hasLength(1), reason: 'nothing before hello');
      link.answerHello();
      await pumpEventQueue();
      final request = link.last<BackendsListRequest>();
      link.deliver(backendsAnswer(request.requestId));
      expect(await pending, isA<Answered<BackendsListResponse>>());
      expect(client.state, isA<ContractReady>());
    });

    test('another major version makes the client incompatible', () async {
      link.answerHello(major: contractProtocolMajor + 1);
      await pumpEventQueue();
      expect(client.state, isA<ContractIncompatible>());
      final reply = await listBackends();
      expect((reply as Failed).failure, isA<VersionMismatch>());
    });

    test('an unsupported_version error makes it incompatible too', () async {
      link.deliver(
        ErrorResponse(
          requestId: link.last<HelloRequest>().requestId,
          error: const ProtocolError(
            code: ProtocolErrorCode.unsupportedVersion,
            message: 'no',
          ),
        ),
      );
      await pumpEventQueue();
      expect(client.state, isA<ContractIncompatible>());
    });

    test('is sent again after a failure it can recover from', () async {
      link.deliver(
        ErrorResponse(
          requestId: link.last<HelloRequest>().requestId,
          error: const ProtocolError(
            code: ProtocolErrorCode.internal,
            message: 'busy',
          ),
        ),
      );
      await pumpEventQueue();
      expect(link.sent, hasLength(1));
      await clock.advance(ContractClient.helloRetryWait);
      expect(link.sent.whereType<HelloRequest>(), hasLength(2));
      link.answerHello();
      await pumpEventQueue();
      expect(client.state, isA<ContractReady>());
    });

    test('a request waits for hello no longer than for an answer', () async {
      link.deliver(
        ErrorResponse(
          requestId: link.last<HelloRequest>().requestId,
          error: const ProtocolError(
            code: ProtocolErrorCode.internal,
            message: 'not yet',
          ),
        ),
      );
      final pending = listBackends();
      for (
        var waited = Duration.zero;
        waited < ContractClient.answerDeadline;
        waited += ContractClient.helloRetryWait
      ) {
        await clock.advance(ContractClient.helloRetryWait);
        link.deliver(
          ErrorResponse(
            requestId: link.last<HelloRequest>().requestId,
            error: const ProtocolError(
              code: ProtocolErrorCode.internal,
              message: 'not yet',
            ),
          ),
        );
      }
      expect(((await pending) as Failed).failure, isA<AnswerTimedOut>());
      expect(link.sent.whereType<BackendsListRequest>(), isEmpty);
    });

    test('a reconnect while hello is unanswered leaves only the new '
        'negotiation', () async {
      link.down();
      link.up();
      await pumpEventQueue();
      expect(link.sent.whereType<HelloRequest>(), hasLength(2));
      expect(client.state, isA<ContractNegotiating>());
      link.answerHello();
      await pumpEventQueue();
      expect((client.state as ContractReady).generation, 1);
    });

    test('runs again on every reconnect, with a new generation', () async {
      link.answerHello();
      await pumpEventQueue();
      expect((client.state as ContractReady).generation, 1);
      link.down();
      expect(client.state, isA<ContractOffline>());
      link.up();
      expect(link.sent.whereType<HelloRequest>(), hasLength(2));
      link.answerHello();
      await pumpEventQueue();
      expect((client.state as ContractReady).generation, 2);
    });
  });

  group('once ready', () {
    setUp(() async {
      link.answerHello();
      await pumpEventQueue();
    });

    test('answers are matched by request id, in any order', () async {
      final first = listBackends();
      final second = client.backendStatus(BackendId.codex);
      await pumpEventQueue();
      final status = link.last<BackendStatusRequest>();
      link.deliver(
        BackendStatusResponse(
          requestId: status.requestId,
          status: const BackendStatus(
            installed: true,
            auth: AuthState.signedIn,
            usable: true,
            issues: [],
          ),
        ),
      );
      link.deliver(backendsAnswer(link.last<BackendsListRequest>().requestId));
      expect(await second, isA<Done<BackendStatus>>());
      expect(await first, isA<Answered<BackendsListResponse>>());
    });

    test('an error answer is a typed refusal', () async {
      final pending = listBackends();
      await pumpEventQueue();
      link.deliver(
        ErrorResponse(
          requestId: link.last<BackendsListRequest>().requestId,
          error: const ProtocolError(
            code: ProtocolErrorCode.unknownBackend,
            message: 'gone',
          ),
        ),
      );
      final failure = ((await pending) as Failed).failure;
      expect(
        (failure as ProtocolRefusal).code,
        ProtocolErrorCode.unknownBackend,
      );
    });

    test('rate_limited is sent again after a wait, then given up', () async {
      final pending = listBackends();
      for (final wait in ContractClient.rateLimitWaits) {
        await pumpEventQueue();
        link.deliver(_rateLimited(link.last<BackendsListRequest>().requestId));
        await pumpEventQueue();
        final sent = link.sent.whereType<BackendsListRequest>().length;
        await clock.advance(wait);
        expect(link.sent.whereType<BackendsListRequest>(), hasLength(sent + 1));
      }
      link.deliver(_rateLimited(link.last<BackendsListRequest>().requestId));
      final failure = ((await pending) as Failed).failure;
      expect((failure as ProtocolRefusal).code, ProtocolErrorCode.rateLimited);
    });

    test('a request with no answer times out at the deadline', () async {
      final pending = listBackends();
      await pumpEventQueue();
      await clock.advance(
        ContractClient.answerDeadline - const Duration(milliseconds: 1),
      );
      var done = false;
      pending.then((_) => done = true).ignore();
      await pumpEventQueue();
      expect(done, isFalse);
      await clock.advance(const Duration(milliseconds: 1));
      expect(((await pending) as Failed).failure, isA<AnswerTimedOut>());
    });

    test(
      'a lost connection fails what waits, and later requests fail fast',
      () async {
        final pending = listBackends();
        await pumpEventQueue();
        link.down();
        expect(((await pending) as Failed).failure, isA<ConnectionLost>());
        final later = await listBackends();
        expect((later as Failed).failure, isA<ConnectionLost>());
        expect(link.sent.whereType<BackendsListRequest>(), hasLength(1));
      },
    );

    test('a frame the link refused fails its request at once', () async {
      final pending = listBackends();
      await pumpEventQueue();
      link.refuse(link.last<BackendsListRequest>().requestId);
      expect(((await pending) as Failed).failure, isA<LinkRefusal>());
    });

    test('an answer that does not decode fails its request', () async {
      final pending = listBackends();
      await pumpEventQueue();
      final requestId = link.last<BackendsListRequest>().requestId;
      link.deliverRaw({
        'type': 'contract',
        'message': {'type': 'backends.list.result', 'requestId': requestId},
      });
      expect(((await pending) as Failed).failure, isA<MalformedAnswer>());
    });

    test('an answer of another type fails its request', () async {
      final pending = listBackends();
      await pumpEventQueue();
      link.deliver(
        SessionDetachResponse(
          requestId: link.last<BackendsListRequest>().requestId,
        ),
      );
      expect(((await pending) as Failed).failure, isA<MalformedAnswer>());
    });

    test('events and catalog news are pushed; other frames are not', () async {
      final events = <EventEnvelope>[];
      final catalog = <CatalogMessage>[];
      client.events.listen(events.add);
      client.catalog.listen(catalog.add);
      link.deliverRaw({'type': 'ping', 'data': <String, Object?>{}});
      link.deliverRaw({'type': 'error', 'message': 'an old error'});
      const envelope = EventEnvelope(
        session: SessionRef(backend: BackendId.pi, sessionId: 's'),
        seq: 1,
        at: 1,
        event: NoticeEvent(level: NoticeLevel.info, text: 'hi'),
      );
      link.deliver(const EventMessage(envelope: envelope));
      link.deliver(
        const CatalogMessage(
          backend: BackendId.pi,
          event: CatalogInvalidatedEvent(scope: CatalogScope.models),
        ),
      );
      expect(events, [envelope]);
      expect(catalog, hasLength(1));
    });

    test('events and answers are numbered in the order they arrived; old '
        'frames are not counted', () async {
      final numbers = <int>[];
      client.events.listen((_) => numbers.add(client.received));
      final pending = listBackends();
      await pumpEventQueue();
      EventMessage event(int seq) => EventMessage(
        envelope: EventEnvelope(
          session: const SessionRef(backend: BackendId.pi, sessionId: 's'),
          seq: seq,
          at: 1,
          event: const NoticeEvent(level: NoticeLevel.info, text: 'hi'),
        ),
      );
      final before = client.received;
      link.deliver(event(1));
      link.deliverRaw({'type': 'ping', 'data': <String, Object?>{}});
      link.deliver(backendsAnswer(link.last<BackendsListRequest>().requestId));
      link.deliver(event(2));
      final reply = (await pending) as Answered<BackendsListResponse>;
      expect(numbers, [before + 1, before + 3]);
      expect(reply.arrival, before + 2);
    });

    test('an event that does not decode names its session as a problem', () {
      final problems = <ContractProblem>[];
      client.problems.listen(problems.add);
      link.deliverRaw({
        'type': 'contract',
        'message': {
          'type': 'event',
          'envelope': {
            'session': {'backend': 'pi', 'sessionId': 's'},
            'seq': 'one',
          },
        },
      });
      final problem = problems.single as UnreadableFrame;
      expect(problem.session?.sessionId, 's');
    });

    test('a send the link throws on fails its request, typed', () async {
      link.brokenSend = true;
      final reply = await listBackends();
      expect((reply as Failed).failure, isA<LinkRefusal>());
    });

    test('dispose ends what waits and sends nothing more', () async {
      final pending = listBackends();
      await pumpEventQueue();
      client.dispose();
      expect(((await pending) as Failed).failure, isA<ClientClosed>());
      final after = await listBackends();
      expect((after as Failed).failure, isA<ClientClosed>());
    });
  });
}

ErrorResponse _rateLimited(String requestId) => ErrorResponse(
  requestId: requestId,
  error: const ProtocolError(
    code: ProtocolErrorCode.rateLimited,
    message: 'slow down',
  ),
);
