import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// One control message to the daemon, for UI actions that act on the machine.
typedef LinkControlSend = void Function(Map<String, Object?> message);

/// Asks the daemon to start the bridge again.
const Map<String, Object?> bridgeRestartControl = <String, Object?>{
  't': 'bridge_restart',
};

final linkControlSendProvider = Provider<LinkControlSend>(
  (ref) => ref.watch(linkConnectionControllerProvider).sendControl,
);
