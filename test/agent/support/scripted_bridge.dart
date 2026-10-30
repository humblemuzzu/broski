import 'package:broski/contract/generated/contract.dart';

import 'fake_contract_link.dart';

/// The bridge core, played by a test over a [FakeContractLink]: it answers
/// `hello` itself, answers other requests with the handlers the test gives,
/// and holds the rest until the test answers them.
final class ScriptedBridge {
  ScriptedBridge(this.link) {
    link.onSent = _onSent;
  }

  final FakeContractLink link;
  final Map<Type, ServerMessage? Function(ClientMessage message)> _handlers =
      {};
  final List<ClientMessage> unanswered = [];

  /// The major version this bridge says `hello` with.
  int helloMajor = contractProtocolMajor;

  /// The minor version it says `hello` with; an older bridge than the app.
  int helloMinor = 0;

  /// Answers every later request of type [T] with what [handler] returns; a
  /// null leaves it unanswered.
  void on<T extends ClientMessage>(ServerMessage? Function(T request) handler) {
    _handlers[T] = (message) => message is T ? handler(message) : null;
  }

  T waiting<T extends ClientMessage>() => unanswered.whereType<T>().last;

  void answer(ServerMessage message) {
    unanswered.removeWhere(
      (request) => request.requestId == _requestIdOf(message),
    );
    link.deliver(message);
  }

  void event(SessionRef session, int seq, AgentEvent event, {int at = 1}) =>
      link.deliver(
        EventMessage(
          envelope: EventEnvelope(
            session: session,
            seq: seq,
            at: at,
            event: event,
          ),
        ),
      );

  void catalog(BackendId backend, CatalogEvent event) =>
      link.deliver(CatalogMessage(backend: backend, event: event));

  void _onSent(ClientMessage message) {
    if (message is HelloRequest) {
      link.deliver(
        HelloResponse(
          requestId: message.requestId,
          protocol: ProtocolVersion(major: helloMajor, minor: helloMinor),
          bridgeVersion: 'test',
        ),
      );
      return;
    }
    final answer = _handlers[message.runtimeType]?.call(message);
    if (answer == null) {
      unanswered.add(message);
    } else {
      link.deliver(answer);
    }
  }
}

String? _requestIdOf(ServerMessage message) => switch (message.toJson()) {
  {'requestId': final String requestId} => requestId,
  _ => null,
};
