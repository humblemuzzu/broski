import 'dart:developer' as developer;

/// The daemon's bridge process, as reported on the control stream.
///
/// [unknown] keeps a newer daemon from being misread: an unrecognised state is
/// still a real change, so it is surfaced rather than ignored.
enum BridgeStatusState {
  up,
  connecting,
  starting,
  down,
  crashed,
  unknown;

  static BridgeStatusState? parse(Object? raw) => switch (raw) {
    'up' => BridgeStatusState.up,
    'connecting' => BridgeStatusState.connecting,
    'starting' => BridgeStatusState.starting,
    'down' => BridgeStatusState.down,
    'crashed' => BridgeStatusState.crashed,
    _ => raw is String ? BridgeStatusState.unknown : null,
  };
}

/// One `{"t":"bridge",…}` control message.
///
/// [conn] counts the bridge sockets this phone's session has had: a new value
/// means the bridge forgot this phone's view, so the app resyncs.
final class BridgeLinkStatus {
  const BridgeLinkStatus({
    required this.state,
    required this.conn,
    this.detail,
  });

  final BridgeStatusState state;
  final int conn;
  final String? detail;

  /// The status [message] carries, or null when it is not one this build can
  /// read: a missing or non-numeric [conn] is refused, never defaulted.
  static BridgeLinkStatus? tryParse(Map<String, Object?> message) {
    if (message['t'] != 'bridge') {
      return null;
    }
    final state = BridgeStatusState.parse(message['state']);
    final conn = message['conn'];
    if (state == null || conn is! int || conn < 0) {
      developer.log(
        'ignoring a bridge status without a usable state and conn: $message',
        name: 'broski_link',
      );
      return null;
    }
    final detail = message['detail'];
    return BridgeLinkStatus(
      state: state,
      conn: conn,
      detail: detail is String ? detail : null,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is BridgeLinkStatus &&
      other.state == state &&
      other.conn == conn &&
      other.detail == detail;

  @override
  int get hashCode => Object.hash(state, conn, detail);

  @override
  String toString() => 'BridgeLinkStatus(${state.name}, conn=$conn, $detail)';
}
