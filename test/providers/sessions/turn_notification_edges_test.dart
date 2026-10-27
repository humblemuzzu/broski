import 'dart:convert';
import 'dart:io';

import 'package:broski/models/claude_code.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/session.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/services/notification_service.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

class _EmptySessionCaches extends StorageService {
  @override
  Future<List<SessionSummary>> getCachedSessions() async => const [];

  @override
  Future<List<ClaudeCodeSession>> getCachedCCSessions() async => const [];

  @override
  Future<List<PiSessionInfo>> getCachedPiSessions() async => const [];
}

/// A completion notification fires on every busy-to-idle edge of a session, so a Pi prompt that runs two
/// tools must produce exactly one such edge: the captured frames are what the bridge sent for that prompt.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a Pi prompt with two tool calls finishes once', () async {
    final socket = FakeWebSocket();
    NotificationService.instance.enabled = false;
    final container = ProviderContainer(
      overrides: [
        bridgeServiceProvider.overrideWithValue(BridgeService(socket)),
        storageServiceProvider.overrideWithValue(_EmptySessionCaches()),
      ],
    );
    addTearDown(() async {
      NotificationService.instance.enabled = true;
      container.dispose();
      await socket.close();
    });
    final edges = <String>[];
    SessionStatus? previous;
    container.listen(globalSessionStatusProvider, (_, statuses) {
      final next = statuses.values.firstOrNull;
      if (previous?.isBusy == true && next?.isIdle == true) edges.add('idle');
      previous = next;
    }, fireImmediately: true);

    final frames =
        (jsonDecode(
                  File(
                    'test/support/fixtures/pi_two_bash_turn.json',
                  ).readAsStringSync(),
                )
                as List<dynamic>)
            .cast<Map<String, dynamic>>();
    for (final frame in frames) {
      socket.deliver(frame);
      await pumpEventQueue();
    }

    expect(edges, ['idle']);
  });
}
