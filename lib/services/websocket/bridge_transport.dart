/// The raw message channel under the bridge protocol: a Broski Link session,
/// which owns routes, keepalive, resume and reconnection itself.
abstract interface class BridgeTransport {
  Stream<dynamic> get stream;

  BridgeSink get sink;

  Future<void> close();
}

abstract interface class BridgeSink {
  /// [tag] is the request id of a message whose reply something waits for, so
  /// a refusal can fail that request instead of leaving it to time out.
  void add(String text, {String? tag});
}
