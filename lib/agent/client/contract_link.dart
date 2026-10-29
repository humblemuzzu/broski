/// The app's one bridge socket, shared with the old protocol until Phase 4.
abstract interface class ContractLink {
  /// Frames of both protocols, in arrival order.
  Stream<Map<String, Object?>> get frames;

  /// A new `true` is a new connection.
  Stream<bool> get reachability;

  bool get reachable;

  /// Never batched: the bridge does not serve a contract frame inside a batch.
  void send(Map<String, Object?> frame);

  Stream<String> get refusedRequestIds;
}
