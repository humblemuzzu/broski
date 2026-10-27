import 'package:broski_link/src/connection/bridge_link_status.dart';
import 'package:broski_link/src/connection/link_send_failure.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:broski_link/src/connection/machine_endpoint.dart';

/// What an owner of one link needs from it.
///
/// [LinkConnection] is the real one; the interface exists so an owner can be handed a stand-in
/// without an isolate, a socket or the native library behind it.
abstract interface class LinkSession {
  Stream<String> get bridgeMessages;

  Stream<Map<String, Object?>> get control;

  Stream<LinkStatus> get status;

  Stream<BridgeLinkStatus> get bridgeStatus;

  Stream<LinkSendFailure> get sendFailures;

  void sendBridge(String text, {String? tag});

  void sendControl(Map<String, Object?> message);

  void updateEndpoint(MachineEndpoint endpoint);

  void networkChanged();

  void appResumed();

  void appPaused();

  Future<void> close();
}
