import 'dart:async';
import 'dart:math';

import 'package:broski/agent/client/agent_clock.dart';
import 'package:broski/agent/client/client_delays.dart';
import 'package:broski/agent/client/contract_failure.dart';
import 'package:broski/agent/client/contract_frame.dart';
import 'package:broski/agent/client/contract_link.dart';
import 'package:broski/agent/client/contract_problem.dart';
import 'package:broski/agent/client/contract_reply.dart';
import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/request_waiters.dart';
import 'package:broski/contract/generated/contract.dart';

/// The phone's one client of the bridge core's contract protocol: `hello`
/// first on every connection, then requests matched to answers by request id,
/// events and catalog news pushed to listeners. Every request ends in a typed
/// [ContractReply]; nothing here throws at a caller.
final class ContractClient {
  /// [info] is read at every `hello`, so it can name an app version that is
  /// only known once the platform answered.
  ContractClient({
    required ContractLink link,
    required ClientInfo Function() info,
    AgentClock clock = const SystemClock(),
  }) : _link = link,
       _info = info,
       _clock = clock,
       _waiters = RequestWaiters(clock),
       _delays = ClientDelays(clock),
       _idPrefix = 'c${Random().nextInt(1 << 32).toRadixString(16)}' {
    _subscriptions.addAll([
      link.frames.listen(_onFrame),
      link.reachability.listen(_onReachability),
      link.refusedRequestIds.listen(_onRefused),
    ]);
    if (link.reachable) unawaited(_negotiate());
  }

  /// The core answers every request within its own deadline (core README
  /// §11); the margin covers the link. Only a lost answer waits this long.
  static const answerDeadline = Duration(
    milliseconds: contractRequestDeadlineMs + 15000,
  );

  /// `rate_limited` means not served: sent again after these waits.
  static const rateLimitWaits = [
    Duration(seconds: 2),
    Duration(seconds: 4),
    Duration(seconds: 8),
  ];

  static const helloRetryWait = Duration(seconds: 2);

  final ContractLink _link;
  final ClientInfo Function() _info;
  final AgentClock _clock;
  final RequestWaiters _waiters;
  final ClientDelays _delays;
  final String _idPrefix;
  final List<StreamSubscription<Object?>> _subscriptions = [];
  final _states = StreamController<ContractState>.broadcast(sync: true);
  final _events = StreamController<EventEnvelope>.broadcast(sync: true);
  final _catalog = StreamController<CatalogMessage>.broadcast(sync: true);
  final _problems = StreamController<ContractProblem>.broadcast(sync: true);
  final List<Completer<void>> _stateWaiters = [];
  ContractState _state = const ContractOffline();
  var _requests = 0;
  var _received = 0;
  var _generation = 0;
  var _negotiation = 0;
  var _closed = false;

  ContractState get state => _state;
  Stream<ContractState> get states => _states.stream;
  Stream<EventEnvelope> get events => _events.stream;
  Stream<CatalogMessage> get catalog => _catalog.stream;
  Stream<ContractProblem> get problems => _problems.stream;

  /// Contract frames read so far. Events reach listeners synchronously, so
  /// inside an [events] listener this numbers the event being delivered; an
  /// [Answered] reply carries its own number, which places the two in the
  /// order the bridge sent them.
  int get received => _received;

  /// Sends the request [build] makes and returns its answer when it is an
  /// [R]; an `error` answer or a lost one is a [Failed] reply.
  Future<ContractReply<R>> request<R extends ServerMessage>(
    ClientMessage Function(RequestId requestId) build,
  ) async {
    for (var attempt = 0; ; attempt++) {
      final unusable = await _whenUsable();
      if (unusable != null) return Failed(unusable);
      final message = build(_nextRequestId());
      final answer = await _exchange(message);
      switch (answer) {
        case WireFailed(:final failure):
          return Failed(failure);
        case WireAnswered(message: final R response, :final arrival):
          return Answered(response, arrival: arrival);
        case WireAnswered(message: ErrorResponse(:final error))
            when error.code == ProtocolErrorCode.rateLimited &&
                attempt < rateLimitWaits.length:
          await _delays.wait(rateLimitWaits[attempt]);
        case WireAnswered(message: ErrorResponse(:final error)):
          return Failed(ProtocolRefusal(error));
        case WireAnswered(message: final other):
          final asked = message.toJson()['type'];
          final got = other.toJson()['type'];
          return Failed(MalformedAnswer('$got answered $asked'));
      }
    }
  }

  void dispose() {
    if (_closed) return;
    _closed = true;
    _negotiation++;
    for (final subscription in _subscriptions) {
      unawaited(subscription.cancel());
    }
    _waiters.failAll(const ClientClosed());
    _delays.close();
    _wakeStateWaiters();
    unawaited(_states.close());
    unawaited(_events.close());
    unawaited(_catalog.close());
    unawaited(_problems.close());
  }

  String _nextRequestId() => '$_idPrefix-${++_requests}';

  /// Null once the protocol is usable. A `hello` under way is waited out,
  /// but no longer than an answer would be.
  Future<ContractFailure?> _whenUsable() async {
    var expired = false;
    void Function()? cancel;
    try {
      while (true) {
        if (_closed) return const ClientClosed();
        switch (_state) {
          case ContractReady():
            return null;
          case ContractOffline():
            return const ConnectionLost();
          case ContractIncompatible(:final detail):
            return VersionMismatch(detail);
          case ContractNegotiating() when expired:
            return const AnswerTimedOut();
          case ContractNegotiating():
            cancel ??= _clock.after(answerDeadline, () {
              expired = true;
              _wakeStateWaiters();
            });
            final changed = Completer<void>();
            _stateWaiters.add(changed);
            await changed.future;
        }
      }
    } finally {
      cancel?.call();
    }
  }

  Future<WireAnswer> _exchange(ClientMessage message) {
    if (_closed) return Future.value(const WireFailed(ClientClosed()));
    if (!_link.reachable) {
      return Future.value(const WireFailed(ConnectionLost()));
    }
    final answer = _waiters.wait(message.requestId, answerDeadline);
    try {
      _link.send(contractFrame(message));
    } on Object catch (error) {
      _waiters.fail(message.requestId, LinkRefusal('$error'));
    }
    return answer;
  }

  Future<void> _negotiate() async {
    final negotiation = ++_negotiation;
    _setState(const ContractNegotiating());
    while (negotiation == _negotiation && !_closed) {
      final hello = HelloRequest(
        requestId: _nextRequestId(),
        protocol: const ProtocolVersion(
          major: contractProtocolMajor,
          minor: contractProtocolMinor,
        ),
        client: _info(),
      );
      final answer = await _exchange(hello);
      if (negotiation != _negotiation || _closed) return;
      final settled = _settleHello(answer);
      if (settled != null) {
        _setState(settled);
        return;
      }
      await _delays.wait(helloRetryWait);
    }
  }

  /// The state a `hello` answer leads to, or null to say `hello` again.
  ContractState? _settleHello(WireAnswer answer) => switch (answer) {
    WireAnswered(message: HelloResponse(:final protocol, :final bridgeVersion))
        when protocol.major == contractProtocolMajor =>
      ContractReady(
        generation: ++_generation,
        bridgeProtocol: protocol,
        bridgeVersion: bridgeVersion,
      ),
    WireAnswered(message: HelloResponse(:final protocol)) =>
      ContractIncompatible(
        'the Mac speaks protocol ${protocol.major}.${protocol.minor}; '
        'this app speaks $contractProtocolMajor.$contractProtocolMinor',
      ),
    WireAnswered(message: ErrorResponse(:final error))
        when error.code == ProtocolErrorCode.unsupportedVersion =>
      ContractIncompatible(error.message),
    WireFailed(failure: ConnectionLost() || ClientClosed()) =>
      const ContractOffline(),
    _ => null,
  };

  void _setState(ContractState next) {
    _state = next;
    _wakeStateWaiters();
    if (!_states.isClosed) _states.add(next);
  }

  void _wakeStateWaiters() {
    final waiting = List.of(_stateWaiters);
    _stateWaiters.clear();
    for (final waiter in waiting) {
      waiter.complete();
    }
  }

  void _onReachability(bool reachable) {
    if (_closed) return;
    if (reachable) {
      unawaited(_negotiate());
      return;
    }
    _negotiation++;
    _setState(const ContractOffline());
    _waiters.failAll(const ConnectionLost());
  }

  void _onRefused(String requestId) => _waiters.fail(
    requestId,
    const LinkRefusal('The phone could not send that to the Mac'),
  );

  void _onFrame(Map<String, Object?> frame) {
    if (_closed) return;
    switch (readFrame(frame)) {
      case OldProtocolFrame():
        return;
      case ContractInbound(:final message):
        _received++;
        _onMessage(message);
      case UnreadableContract(:final requestId, :final problem):
        _received++;
        final failed =
            requestId != null &&
            _waiters.fail(requestId, MalformedAnswer(problem));
        if (!failed) _problems.add(unreadableFrame(frame, problem));
    }
  }

  void _onMessage(ServerMessage message) {
    switch (message) {
      case EventMessage(:final envelope):
        _events.add(envelope);
      case CatalogMessage():
        _catalog.add(message);
      case ErrorResponse(requestId: null, :final error):
        _problems.add(UnattributedError(error));
      default:
        final requestId = answeredRequestId(message);
        if (requestId != null) {
          _waiters.answer(requestId, message, arrival: _received);
        }
    }
  }
}
