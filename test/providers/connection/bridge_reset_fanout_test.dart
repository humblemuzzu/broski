import 'dart:async';

import 'package:broski/providers/connection/bridge_reset_fanout.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_reset_exception.dart';
import 'package:broski/services/pi_bridge_service.dart';
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

  test('one reset fails the bridge and the Pi backend alike', () async {
    final bridge = container.read(bridgeServiceProvider);
    final pi = container.read(piBridgeServiceProvider);

    final sessions = bridge.listSessions();
    final state = pi.getState();
    final tools = pi.getTools();
    await pumpEventQueue();
    expect(socket.sent, hasLength(3));

    container
        .read(bridgeResetFanoutProvider)
        .failAll(BridgeResetReason.bridgeRestarted);

    for (final request in <Future<Object?>>[sessions, state, tools]) {
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
    final pi = container.read(piBridgeServiceProvider);

    final refused = bridge.listSessions();
    final piState = pi.getState();
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

    // The Pi request is still waiting: a refusal names one message, not a backend.
    var settled = false;
    unawaited(
      piState
          .then((_) {}, onError: (Object _) {})
          .whenComplete(() => settled = true),
    );
    await pumpEventQueue();
    expect(settled, isFalse);
  });

  test('a reset reaches both halves even with nothing in flight', () async {
    final pi = container.read(piBridgeServiceProvider);
    container
        .read(bridgeResetFanoutProvider)
        .failAll(BridgeResetReason.bridgeUnavailable);

    final state = pi.getState();
    final sessions = container.read(bridgeServiceProvider).listSessions();
    await pumpEventQueue();
    socket.deliver({
      'type': 'pi_state',
      'requestId': socket.sent.first['requestId'],
      'data': <String, Object?>{'messages': <Object?>[]},
    });
    socket.deliver({
      'type': 'sessions',
      'requestId': socket.lastRequestId,
      'data': <Map<String, dynamic>>[],
    });

    await expectLater(state, completes);
    await expectLater(sessions, completes);
  });
}
