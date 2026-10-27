import 'dart:convert';
import 'dart:typed_data';

import 'package:broski_link/src/connection/link_outbound_queue.dart';
import 'package:broski_link/src/connection/link_send_failure.dart';
import 'package:broski_link/src/errors.dart';
import 'package:test/test.dart';

/// A session that delivers what it is handed, or pushes back, or refuses one
/// message outright.
final class FakeSession {
  final List<({int stream, String text})> delivered = [];
  LinkException? poison;
  var windowOpen = true;
  var notReady = false;

  void send(int stream, Uint8List bytes) {
    final refusal = poison;
    if (refusal != null) {
      poison = null;
      throw refusal;
    }
    if (notReady) {
      throw const LinkNotReadyException(
        -4,
        'no session: no handshake has completed yet',
      );
    }
    if (!windowOpen) {
      throw const LinkBackpressureException(-3, 'backpressure');
    }
    delivered.add((stream: stream, text: utf8.decode(bytes)));
  }
}

Uint8List frame(String text) => Uint8List.fromList(utf8.encode(text));

void main() {
  late FakeSession session;
  late List<LinkSendFailure> failures;
  late LinkOutboundQueue queue;

  setUp(() {
    session = FakeSession();
    failures = [];
    queue = LinkOutboundQueue(sendFrame: session.send, report: failures.add);
  });

  List<String> delivered() => [for (final item in session.delivered) item.text];

  test('a closed window keeps every message, in order, until it opens', () {
    queue.ready = true;
    session.windowOpen = false;
    for (final text in ['one', 'two', 'three']) {
      queue.send(1, frame(text));
    }
    expect(session.delivered, isEmpty);
    expect(queue.queuedMessages, 3);
    expect(failures, isEmpty, reason: 'nothing was shed');

    session.windowOpen = true;
    queue.pump();

    expect(delivered(), ['one', 'two', 'three']);
    expect(queue.queuedBytes, 0);
    expect(failures, isEmpty);
  });

  test('a message sent while the window is closed waits behind the others', () {
    queue.ready = true;
    session.windowOpen = false;
    queue.send(1, frame('first'));
    queue.send(1, frame('second'));

    session.windowOpen = true;
    queue.pump();
    queue.send(1, frame('third'));
    queue.pump();

    expect(delivered(), ['first', 'second', 'third']);
  });

  test('nothing leaves before a session is ready', () {
    queue.send(1, frame('early'));
    expect(session.delivered, isEmpty);
    expect(queue.queuedMessages, 1);

    queue.ready = true;
    expect(delivered(), ['early']);
  });

  test('a full queue refuses the newest send and reports it', () {
    queue.ready = true;
    session.windowOpen = false;
    queue.send(1, Uint8List(linkOutboundQueueMax));
    queue.send(1, frame('one byte too many'));

    expect(failures.single.reason, LinkSendFailureReason.queueFull);
    expect(failures.single.bytes, 'one byte too many'.length);
    expect(queue.queuedMessages, 1);
  });

  test(
    'a message larger than the queue could ever hold is refused at once',
    () {
      queue.ready = true;
      queue.send(1, Uint8List(linkOutboundQueueMax + 1), tag: 'req_4');

      expect(failures.single.reason, LinkSendFailureReason.tooLarge);
      expect(failures.single.bytes, linkOutboundQueueMax + 1);
      expect(failures.single.tag, 'req_4');
      expect(queue.queuedMessages, 0);
    },
  );

  test('a refused message keeps the tag its sender gave it', () {
    queue.ready = true;
    session.poison = const LinkProtocolException(-2, 'closed');
    queue.send(1, frame('poisoned'), tag: 'req_9');

    expect(failures.single.reason, LinkSendFailureReason.rejected);
    expect(failures.single.tag, 'req_9');
  });

  test('a message the session refuses is dropped alone, not as a barrier', () {
    queue.ready = true;
    session.poison = const LinkProtocolException(-2, 'closed');
    queue.send(1, frame('poisoned'));
    queue.send(1, frame('after'));

    expect(failures.single.reason, LinkSendFailureReason.rejected);
    expect(failures.single.bytes, 'poisoned'.length);
    expect(delivered(), ['after']);
  });

  test('a session that is not up yet holds messages instead of reporting', () {
    queue.ready = true;
    session.notReady = true;
    queue.send(1, frame('waits'));

    expect(failures, isEmpty);
    expect(queue.queuedMessages, 1);

    session.notReady = false;
    queue.pump();
    expect(delivered(), ['waits']);
  });

  test('a reset clears the queue and reports what it dropped', () {
    queue.send(1, frame('aa'));
    queue.send(0, frame('bbb'));
    queue.reset();

    expect(failures.single.reason, LinkSendFailureReason.sessionReset);
    expect(failures.single.count, 2);
    expect(failures.single.bytes, 5);
    expect(queue.queuedMessages, 0);

    queue.reset();
    expect(failures, hasLength(1), reason: 'an empty reset reports nothing');
  });
}
