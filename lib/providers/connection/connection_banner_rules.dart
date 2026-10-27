import 'package:broski/providers/connection_provider.dart';
import 'package:broski/services/websocket_service.dart' show ConnectionStatus;

/// Whether the "Reconnecting…" banner belongs on screen.
///
/// Only an attempt in progress earns it. A link whose machine is offline or
/// asleep is not reconnecting — the chip beside the machine already says which —
/// so the banner must not promise a connection nothing is making.
bool showReconnectingBanner(BridgeConnectionState connection) =>
    connection.isReconnecting &&
    !connection.isOfflineMode &&
    connection.status == ConnectionStatus.connecting;
