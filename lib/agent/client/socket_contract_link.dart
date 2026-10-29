import 'package:broski/agent/client/contract_link.dart';
import 'package:broski/services/websocket_service.dart'
    show ConnectionStatus, WebSocketService;
import 'package:broski_link/broski_link.dart' show LinkSendFailure;

/// The contract's link over the app's [WebSocketService], the transport the
/// old services use too: same socket, same heartbeat answers, same status.
final class SocketContractLink implements ContractLink {
  SocketContractLink(this._socket, {required Stream<LinkSendFailure> failures})
    : _failures = failures;

  final WebSocketService _socket;
  final Stream<LinkSendFailure> _failures;

  @override
  Stream<Map<String, Object?>> get frames => _socket.messages;

  @override
  Stream<bool> get reachability => _socket.statusStream
      .map((status) => status == ConnectionStatus.connected)
      .distinct();

  @override
  bool get reachable => _socket.status == ConnectionStatus.connected;

  /// The socket tags a contract frame with its request id, so a refusal by
  /// the link comes back on [refusedRequestIds].
  @override
  void send(Map<String, Object?> frame) => _socket.sendImmediate(frame);

  @override
  Stream<String> get refusedRequestIds =>
      _failures.expand((failure) => [if (failure.tag case final tag?) tag]);
}
