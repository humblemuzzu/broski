import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';

/// Starts the isolate side of one link.
///
/// A seam, not a test hook: the controller can be handed a [LinkSession] that
/// never spawns an isolate, which is how a reconnect, a superseded dial or a
/// discovered route can be exercised without a machine behind it.
typedef LinkSessionStarter =
    Future<LinkSession> Function({
      required Uint8List identitySecret,
      required MachineEndpoint endpoint,
      Uint8List? pairingSecret,
    });

/// The real starter: the Rust link in its own isolate.
Future<LinkSession> startLinkSession({
  required Uint8List identitySecret,
  required MachineEndpoint endpoint,
  Uint8List? pairingSecret,
}) => LinkConnection.start(
  identitySecret: identitySecret,
  endpoint: endpoint,
  pairingSecret: pairingSecret,
);
