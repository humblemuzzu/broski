import 'dart:async';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'harness.dart';

void main() {
  late LinkConnection connection;
  late List<LinkSendFailure> failures;
  late StreamSubscription<LinkSendFailure> subscription;

  setUp(() async {
    failures = [];
    connection = await LinkConnection.start(
      identitySecret: LinkIdentity.generate().secret,
      endpoint: MachineEndpoint(
        machineId: 'machine-1',
        serverPublicBundle: fakeBundle(),
        deviceId: 'device-1',
        lan: const <String>['127.0.0.1:1'],
      ),
    );
    subscription = connection.sendFailures.listen(failures.add);
  });

  tearDown(() async {
    await subscription.cancel();
    await connection.close();
  });

  /// A failure reaches the stream on a later microtask, so the test waits for
  /// the one it is about instead of for a duration.
  Future<LinkSendFailure> nextFailure() {
    final completer = Completer<LinkSendFailure>();
    final listener = connection.sendFailures.listen(completer.complete);
    addTearDown(listener.cancel);
    return completer.future.timeout(const Duration(seconds: 5));
  }

  test('a message past the queue bound is refused with its tag', () async {
    final failure = nextFailure();

    connection.sendBridge('x' * (linkOutboundQueueMax + 1), tag: 'req_7');

    final reported = await failure;
    expect(reported.reason, LinkSendFailureReason.tooLarge);
    expect(reported.stream, 1);
    expect(reported.tag, 'req_7');
    expect(reported.bytes, linkOutboundQueueMax + 1);
  });

  test('a refused message that nothing waits on carries no tag', () async {
    final failure = nextFailure();

    connection.sendBridge('x' * (linkOutboundQueueMax + 1));

    expect((await failure).tag, isNull);
  });

  test('a message that fits is not reported as refused', () async {
    connection.sendBridge('{"type":"set_view"}', tag: 'req_8');

    expect(failures, isEmpty);
  });
}
