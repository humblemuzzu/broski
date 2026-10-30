import 'dart:async';

import 'package:broski/providers/connection/bridge_reset_fanout.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_reset_exception.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

void main() {
  late FakeWebSocket socket;
  late ProviderContainer container;

  setUp(() {
    socket = FakeWebSocket();
    container = ProviderContainer(
      overrides: [webSocketServiceProvider.overrideWithValue(socket)],
    );
  });

  tearDown(() async {
    container.dispose();
    await socket.close();
  });

  test('one reset fails every request still waiting', () async {
    final bridge = container.read(bridgeServiceProvider);

    final sessions = bridge.listSessions();
    final projects = bridge.listProjects();
    await pumpEventQueue();
    expect(socket.sent, hasLength(2));

    container
        .read(bridgeResetFanoutProvider)
        .failAll(BridgeResetReason.bridgeRestarted);

    for (final request in <Future<Object?>>[sessions, projects]) {
      await expectLater(
        request,
        throwsA(
          isA<BridgeResetException>().having(
            (error) => error.reason,
            'reason',
            BridgeResetReason.bridgeRestarted,
          ),
        ),
      );
    }
  });

  test('a refused send fails only the request it named', () async {
    final bridge = container.read(bridgeServiceProvider);

    final refused = bridge.listSessions();
    final other = bridge.listProjects();
    await pumpEventQueue();
    final refusedId = socket.sent.first['requestId'] as String;

    container
        .read(bridgeResetFanoutProvider)
        .refuse(refusedId, LinkSendFailureReason.tooLarge);

    await expectLater(
      refused,
      throwsA(
        isA<BridgeSendRefusedException>().having(
          (error) => error.reason,
          'reason',
          LinkSendFailureReason.tooLarge,
        ),
      ),
    );

    var settled = false;
    unawaited(
      other
          .then((_) {}, onError: (Object _) {})
          .whenComplete(() => settled = true),
    );
    await pumpEventQueue();
    expect(settled, isFalse);
  });

  test('a reset with nothing in flight leaves later requests alone', () async {
    container
        .read(bridgeResetFanoutProvider)
        .failAll(BridgeResetReason.bridgeUnavailable);

    final sessions = container.read(bridgeServiceProvider).listSessions();
    await pumpEventQueue();
    socket.deliver({
      'type': 'sessions',
      'requestId': socket.lastRequestId,
      'data': <Map<String, dynamic>>[],
    });

    await expectLater(sessions, completes);
  });
}
