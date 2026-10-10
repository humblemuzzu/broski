import 'dart:isolate';

import 'package:broski_link/src/connection/isolate_protocol.dart';
import 'package:broski_link/src/connection/link_engine.dart';

/// Entry point of the link isolate.
void linkIsolateEntry(LinkStart start) {
  final commands = ReceivePort();
  final engine = LinkEngine(
    events: start.events,
    commands: commands,
    identitySecret: start.identitySecret,
    endpoint: start.endpoint,
    pairingSecret: start.pairingSecret,
  );
  commands.listen((Object? message) {
    if (message is LinkCommand) {
      engine.handle(message);
    }
  });
  start.events.send(LinkIsolateReady(commands.sendPort));
  engine.run();
}
