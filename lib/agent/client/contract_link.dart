import 'package:broski/agent/client/contract_frame.dart';

/// The app's one bridge socket, shared with the old protocol until Phase 4.
abstract interface class ContractLink {
  /// The contract frames, read, in the order they arrived on the connection.
  /// A listener is called synchronously, one frame at a time.
  Stream<InboundFrame> get frames;

  /// A new `true` is a new connection.
  Stream<bool> get reachability;

  bool get reachable;

  /// Never batched: the bridge does not serve a contract frame inside a batch.
  void send(Map<String, Object?> frame);

  Stream<String> get refusedRequestIds;

  /// The client is done with the link: it reads no more frames.
  void close();
}
