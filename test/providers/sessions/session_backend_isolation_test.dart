import 'package:broski/models/claude_code.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/codex_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_response_error.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

/// Every backend's list and every backend's project picker load on their own: the Pi list being
/// refused by the link must leave the Claude Code list and both project pickers working.
void main() {
  late FakeWebSocket socket;
  late ProviderContainer container;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    socket = FakeWebSocket();
    container = ProviderContainer(
      overrides: [
        webSocketServiceProvider.overrideWithValue(socket),
        storageServiceProvider.overrideWithValue(
          StorageService()..clearMemoryCache(),
        ),
      ],
    );
  });

  tearDown(() async {
    container.dispose();
    await socket.close();
  });

  Future<void> settle(bool Function() done) async {
    for (var attempt = 0; attempt < 100 && !done(); attempt++) {
      await pumpEventQueue();
    }
    expect(done(), isTrue, reason: 'the app never settled');
  }

  Map<String, dynamic> lastSent(String type) =>
      socket.sent.lastWhere((message) => message['type'] == type);

  /// Refuses every `pi_list_sessions` the retrying page fetch asks for, as the link would.
  Future<int> refuseEveryPiPage() async {
    var answered = 0;
    while (container.read(piSessionsProvider(null)).isLoading) {
      await pumpEventQueue();
      final asked = socket.sent
          .where((m) => m['type'] == 'pi_list_sessions')
          .length;
      if (asked <= answered) continue;
      answered = asked;
      socket.deliver({
        'type': 'error',
        'code': bridgeResponseTooLargeCode,
        'requestId': lastSent('pi_list_sessions')['requestId'],
        'bytes': 18 * 1024 * 1024,
        'limit': 8 * 1024 * 1024,
        'message': 'Response too large for the link',
      });
    }
    return answered;
  }

  test(
    'a refused Pi list leaves the Claude Code list and both pickers working',
    () async {
      container.read(piSessionsProvider(null));
      await settle(() => socket.sent.isNotEmpty);

      expect(await refuseEveryPiPage(), greaterThan(1));
      expect(container.read(piSessionsProvider(null)).hasError, isTrue);

      final ccSessions = container.read(ccSessionsProvider.notifier);
      final ccLoading = ccSessions.load();
      await settle(
        () => socket.sent.any((m) => m['type'] == 'cc_list_sessions'),
      );
      socket.deliver({
        'type': 'cc_sessions',
        'requestId': lastSent('cc_list_sessions')['requestId'],
        'data': <Map<String, dynamic>>[
          {
            'id': 'cc-1',
            'title': 'Claude session',
            'cwd': '/tmp/cc-project',
            'createdAt': 1700000000000,
            'updatedAt': 1700000000000,
          },
        ],
        'hasMore': false,
      });
      await ccLoading;

      final ccRows = container.read(ccSessionsProvider).valueOrNull;
      expect(ccRows, isNotNull);
      expect(ccRows!.single, isA<ClaudeCodeSession>());
      expect(ccRows.single.id, 'cc-1');

      final cxThreads = container.read(codexThreadsProvider.notifier);
      final cxLoading = cxThreads.load();
      await settle(
        () => socket.sent.any((m) => m['type'] == 'cx_list_threads'),
      );
      socket.deliver({
        'type': 'cx_threads',
        'requestId': lastSent('cx_list_threads')['requestId'],
        'data': <Map<String, dynamic>>[
          {
            'id': 'cx-1',
            'preview': 'Codex thread',
            'createdAt': 1700000000,
            'updatedAt': 1700000000,
            'cwd': '/tmp/cx-project',
          },
        ],
        'hasMore': false,
      });
      await cxLoading;

      final cxRows = container.read(codexThreadsProvider).valueOrNull;
      expect(cxRows, isNotNull);
      expect(cxRows!.single, isA<CodexThread>());

      final piProjects = container.read(piProjectsForSessionsProvider.future);
      await settle(
        () => socket.sent.any((m) => m['type'] == 'pi_list_projects'),
      );
      socket.deliver({
        'type': 'pi_projects',
        'requestId': lastSent('pi_list_projects')['requestId'],
        'data': <Map<String, dynamic>>[
          {
            'id': '/tmp/pi-project',
            'name': 'pi-project',
            'path': '/tmp/pi-project',
          },
        ],
      });
      expect(await piProjects, hasLength(1));

      final ccProjects = container.read(ccProjectsForSessionsProvider.future);
      await settle(
        () => socket.sent.any((m) => m['type'] == 'cc_list_projects'),
      );
      socket.deliver({
        'type': 'cc_projects',
        'requestId': lastSent('cc_list_projects')['requestId'],
        'data': <Map<String, dynamic>>[
          {
            'id': '/tmp/cc-project',
            'name': 'cc-project',
            'path': '/tmp/cc-project',
          },
        ],
      });
      final projects = await ccProjects;
      expect(projects.single, isA<ProjectSummary>());
      expect(projects.single.path, '/tmp/cc-project');
    },
  );

  test('the Pi list keeps its rows when the next page fails', () async {
    final notifier = container.read(piSessionsProvider(null).notifier);
    await settle(() => socket.sent.isNotEmpty);
    socket.deliver({
      'type': 'pi_sessions',
      'requestId': socket.lastRequestId,
      'data': <Map<String, dynamic>>[
        {
          'path': '/tmp/pi-project/s1.jsonl',
          'id': 's1',
          'cwd': '/tmp/pi-project',
          'created': 1700000000000,
          'modified': 1700000000000,
          'messageCount': 1,
          'firstMessage': 'hello',
        },
      ],
      'hasMore': true,
      'nextCursor': 'cursor-1',
    });
    await settle(() => !container.read(piSessionsProvider(null)).isLoading);

    final rows = container.read(piSessionsProvider(null)).valueOrNull;
    expect(rows, isNotNull);
    expect(rows!.single, isA<PiSessionInfo>());
    expect(notifier.hasMore, isTrue);

    final requestsBefore = socket.sent.length;
    final page = notifier.loadMore();
    await settle(() => socket.sent.length > requestsBefore);
    expect(lastSent('pi_list_sessions')['before'], 'cursor-1');
    socket.deliver({
      'type': 'error',
      'requestId': socket.lastRequestId,
      'message': 'no such page',
    });
    await page;

    expect(notifier.loadMoreFailed, isTrue);
    expect(container.read(piSessionsProvider(null)).valueOrNull, hasLength(1));
  });
}
