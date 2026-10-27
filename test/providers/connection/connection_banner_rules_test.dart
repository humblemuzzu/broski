import 'package:broski/providers/connection/connection_banner_rules.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:flutter_test/flutter_test.dart';

BridgeConnectionState _state({
  required ConnectionStatus status,
  bool reconnecting = true,
  bool offlineMode = false,
}) => BridgeConnectionState(
  status: status,
  isReconnecting: reconnecting,
  isOfflineMode: offlineMode,
);

void main() {
  test('shows while an attempt is in progress', () {
    expect(
      showReconnectingBanner(_state(status: ConnectionStatus.connecting)),
      isTrue,
    );
  });

  test('stays away once the link reports a machine that is not there', () {
    expect(
      showReconnectingBanner(_state(status: ConnectionStatus.disconnected)),
      isFalse,
    );
  });

  test('stays away while connected, and in offline mode', () {
    expect(
      showReconnectingBanner(_state(status: ConnectionStatus.connected)),
      isFalse,
    );
    expect(
      showReconnectingBanner(
        _state(status: ConnectionStatus.connecting, offlineMode: true),
      ),
      isFalse,
    );
    expect(
      showReconnectingBanner(
        _state(status: ConnectionStatus.connecting, reconnecting: false),
      ),
      isFalse,
    );
  });
}
