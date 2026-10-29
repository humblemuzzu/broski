import 'dart:async';

import 'package:broski/agent/client/contract_link.dart';
import 'package:broski/contract/generated/contract.dart';

/// The bridge socket, played by the test: it sees every frame the client
/// sends and decides what comes back and when the link goes up or down.
final class FakeContractLink implements ContractLink {
  FakeContractLink({bool reachable = true}) : _reachable = reachable;

  final _frames = StreamController<Map<String, Object?>>.broadcast(sync: true);
  final _reachability = StreamController<bool>.broadcast(sync: true);
  final _refused = StreamController<String>.broadcast(sync: true);
  bool _reachable;

  /// Every client message sent, decoded, oldest first.
  final List<ClientMessage> sent = [];

  /// Called with each message as it is sent, to answer it.
  void Function(ClientMessage message)? onSent;

  /// Makes every later send throw, as a link torn down under the client may.
  bool brokenSend = false;

  @override
  Stream<Map<String, Object?>> get frames => _frames.stream;

  @override
  Stream<bool> get reachability => _reachability.stream;

  @override
  bool get reachable => _reachable;

  @override
  Stream<String> get refusedRequestIds => _refused.stream;

  @override
  void send(Map<String, Object?> frame) {
    if (brokenSend) throw StateError('the link is closed');
    final message = frame['message'];
    if (frame['type'] != 'contract' ||
        frame.length != 2 ||
        message is! Map<String, Object?>) {
      throw StateError('not a contract frame: $frame');
    }
    final decoded = ClientMessage.fromJson(message);
    sent.add(decoded);
    onSent?.call(decoded);
  }

  T last<T extends ClientMessage>() => sent.whereType<T>().last;

  void up() {
    _reachable = true;
    _reachability.add(true);
  }

  void down() {
    _reachable = false;
    _reachability.add(false);
  }

  void deliver(ServerMessage message) =>
      _frames.add({'type': 'contract', 'message': message.toJson()});

  void deliverRaw(Map<String, Object?> frame) => _frames.add(frame);

  void refuse(String requestId) => _refused.add(requestId);

  /// Answers the newest `hello` as a bridge of [major].[minor] would.
  void answerHello({int major = contractProtocolMajor, int minor = 0}) {
    deliver(
      HelloResponse(
        requestId: last<HelloRequest>().requestId,
        protocol: ProtocolVersion(major: major, minor: minor),
        bridgeVersion: '9.9.9',
      ),
    );
  }
}
