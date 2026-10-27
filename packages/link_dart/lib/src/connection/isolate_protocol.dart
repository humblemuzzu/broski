import 'dart:isolate';
import 'dart:typed_data';

import 'package:broski_link/src/connection/link_send_failure.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:broski_link/src/connection/machine_endpoint.dart';

/// Spawn message of the link isolate.
final class LinkStart {
  const LinkStart({
    required this.events,
    required this.identitySecret,
    required this.endpoint,
    this.pairingSecret,
  });

  final SendPort events;
  final Uint8List identitySecret;
  final MachineEndpoint endpoint;
  final Uint8List? pairingSecret;
}

/// What the main isolate sends to the link isolate.
sealed class LinkCommand {
  const LinkCommand();
}

final class LinkSendBridge extends LinkCommand {
  const LinkSendBridge(this.text);

  final String text;
}

final class LinkSendControl extends LinkCommand {
  const LinkSendControl(this.message);

  final Map<String, Object?> message;
}

final class LinkSetEndpoint extends LinkCommand {
  const LinkSetEndpoint(this.endpoint);

  final MachineEndpoint endpoint;
}

final class LinkNetworkChanged extends LinkCommand {
  const LinkNetworkChanged();
}

final class LinkAppResumed extends LinkCommand {
  const LinkAppResumed();
}

final class LinkAppPaused extends LinkCommand {
  const LinkAppPaused();
}

final class LinkShutdown extends LinkCommand {
  const LinkShutdown();
}

/// What the link isolate sends to the main isolate.
sealed class LinkIsolateEvent {
  const LinkIsolateEvent();
}

/// The isolate is up; [commands] accepts [LinkCommand]s.
final class LinkIsolateReady extends LinkIsolateEvent {
  const LinkIsolateReady(this.commands);

  final SendPort commands;
}

final class LinkIsolateStatus extends LinkIsolateEvent {
  const LinkIsolateStatus(this.status);

  final LinkStatus status;
}

final class LinkIsolateBridge extends LinkIsolateEvent {
  const LinkIsolateBridge(this.text);

  final String text;
}

final class LinkIsolateControl extends LinkIsolateEvent {
  const LinkIsolateControl(this.message);

  final Map<String, Object?> message;
}

/// A message the session refused; nothing else will carry it.
final class LinkIsolateSendFailure extends LinkIsolateEvent {
  const LinkIsolateSendFailure(this.failure);

  final LinkSendFailure failure;
}

/// The isolate closed everything and is about to exit.
final class LinkIsolateStopped extends LinkIsolateEvent {
  const LinkIsolateStopped();
}
