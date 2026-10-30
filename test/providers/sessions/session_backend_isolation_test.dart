import 'package:broski/models/claude_code.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/codex_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_response_error.dart';
import 'package:broski/services/storage_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

/// Every backend's list and every backend's project picker load on their own: the Claude Code list
/// being refused by the link must leave the Codex list and the project picker working.
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

  /// Refuses every `cc_list_sessions` the retrying page fetch asks for, as the link would.
  Future<int> refuseEveryCcPage() async {
    var answered = 0;
    while (container.read(ccSessionsProvider).isLoading) {
      await pumpEventQueue();
      final asked = socket.sent
          .where((m) => m['type'] == 'cc_list_sessions')
          .length;
      if (asked <= answered) continue;
      answered = asked;
      socket.deliver({
        'type': 'error',
        'code': bridgeResponseTooLargeCode,
        'requestId': lastSent('cc_list_sessions')['requestId'],
        'bytes': 18 * 1024 * 1024,
        'limit': 8 * 1024 * 1024,
        'message': 'Response too large for the link',
      });
    }
    return answered;
  }

  test(
    'a refused Claude Code list leaves the Codex list and the picker working',
    () async {
      final ccLoading = container.read(ccSessionsProvider.notifier).load();
      await settle(() => socket.sent.isNotEmpty);

      expect(await refuseEveryCcPage(), greaterThan(1));
      await ccLoading;
      expect(container.read(ccSessionsProvider).hasError, isTrue);

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

  test(
    'the Claude Code list keeps its rows when the next page fails',
    () async {
      final notifier = container.read(ccSessionsProvider.notifier);
      final loading = notifier.load();
      await settle(() => socket.sent.isNotEmpty);
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
        'hasMore': true,
        'nextCursor': 'cursor-1',
      });
      await loading;

      final rows = container.read(ccSessionsProvider).valueOrNull;
      expect(rows, isNotNull);
      expect(rows!.single, isA<ClaudeCodeSession>());
      expect(notifier.hasMore, isTrue);

      final requestsBefore = socket.sent.length;
      final page = notifier.loadMore();
      await settle(() => socket.sent.length > requestsBefore);
      expect(lastSent('cc_list_sessions')['before'], 'cursor-1');
      socket.deliver({
        'type': 'error',
        'requestId': socket.lastRequestId,
        'message': 'no such page',
      });
      await page;

      expect(notifier.loadMoreFailed, isTrue);
      expect(container.read(ccSessionsProvider).valueOrNull, hasLength(1));
    },
  );
}
