import 'dart:convert';
import 'dart:typed_data';

import 'package:broski_link/broski_link.dart';
import 'package:broski_link/src/connection/link_session_io.dart';
import 'package:test/test.dart';

import 'harness.dart';

void main() {
  late List<LinkSendFailure> failures;
  late List<Uint8List> wire;
  late LinkSessionIo io;

  setUp(() {
    failures = [];
    wire = [];
    io = LinkSessionIo(
      identitySecret: LinkIdentity.generate().secret,
      serverBundle: fakeBundle(),
      onWire: wire.add,
      onConnected: (bool _, bool _) {},
      onBridge: (String _) {},
      onControl: (Map<String, Object?> _) {},
      onFailed: () => fail('the link failed before a handshake'),
      onPeerClosed: (int code) => fail('the peer closed with $code'),
      onSendFailure: failures.add,
    );
  });

  tearDown(() => io.stop());

  test('a message with no session yet waits instead of going nowhere', () {
    io.send(1, Uint8List.fromList(utf8.encode('{"type":"set_view"}')));

    expect(failures, isEmpty);
    expect(wire, isEmpty);
  });

  test('a message the session could never carry is refused at once', () {
    io.send(0, Uint8List(linkOutboundQueueMax + 1));

    expect(failures.single.reason, LinkSendFailureReason.tooLarge);
    expect(wire, isEmpty);
  });
}
