import 'dart:async';

import 'package:broski/agent/client/contract_frame.dart';
import 'package:broski/agent/client/contract_link.dart';
import 'package:broski/agent/client/frame_lane.dart';
import 'package:broski/services/websocket_service.dart'
    show ConnectionStatus, WebSocketService;
import 'package:broski_link/broski_link.dart' show LinkSendFailure;

/// The contract's link over the app's [WebSocketService], the transport the
/// old services use too: same socket, same heartbeat answers, same status.
///
/// The socket offers every text frame to [claim] before it decodes it: a
/// contract frame is taken whole, and a [FrameLane] reads it, off the UI
/// isolate when it is large, delivering frames in the order they arrived. The
/// old protocol's frames go on to the old services as before.
final class SocketContractLink implements ContractLink {
  SocketContractLink(this._socket, {required Stream<LinkSendFailure> failures})
    : _failures = failures {
    _lane = FrameLane(deliver: _frames.add);
    _socket.frameClaim = claim;
    _formDeviations = _socket.messages.listen(_deviant);
  }

  final WebSocketService _socket;
  final Stream<LinkSendFailure> _failures;
  final _frames = StreamController<InboundFrame>.broadcast(sync: true);
  late final FrameLane _lane;
  late final StreamSubscription<Map<String, Object?>> _formDeviations;

  @override
  Stream<InboundFrame> get frames => _frames.stream;

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

  /// Takes [text] when it begins as the bridge core begins every contract
  /// frame.
  bool claim(String text) {
    if (!text.startsWith(contractFramePrefix)) return false;
    _lane.add(text);
    return true;
  }

  /// A contract frame the socket decoded for the old services because it did
  /// not begin as the core's do. The bridge sends none; one is reported, not
  /// read, since it cannot be put in order with the frames the lane holds.
  void _deviant(Map<String, Object?> frame) {
    if (frame['type'] != contractFrameType) return;
    final requestId = switch (frame['message']) {
      {'requestId': final String id} => id,
      _ => null,
    };
    _frames.add(
      UnreadableContract(
        requestId: requestId,
        problem:
            'a contract frame arrived in a form the bridge core never '
            'sends',
      ),
    );
  }

  @override
  void close() {
    _socket.frameClaim = null;
    _lane.close();
    unawaited(_formDeviations.cancel());
    unawaited(_frames.close());
  }
}
