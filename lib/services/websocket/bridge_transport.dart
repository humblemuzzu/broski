/// The raw message channel under the bridge protocol: a Broski Link session,
/// which owns routes, keepalive, resume and reconnection itself.
abstract interface class BridgeTransport {
  Stream<dynamic> get stream;

  BridgeSink get sink;

  Future<void> close();
}

abstract interface class BridgeSink {
  void add(String text);
}
