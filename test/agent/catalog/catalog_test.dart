import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/backends_controller.dart';
import 'package:broski/agent/catalog/catalog_lists.dart';
import 'package:broski/agent/catalog/directories_controller.dart';
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fake_contract_link.dart';
import '../support/scripted_bridge.dart';

const _status = BackendStatus(
  installed: true,
  auth: AuthState.signedIn,
  usable: true,
  issues: [],
);

SessionSummary _row(String id, int updatedAt, {bool archived = false}) =>
    SessionSummary(
      session: SessionRef(backend: BackendId.codex, sessionId: id),
      updatedAt: updatedAt,
      archived: archived,
      status: SessionStatus.idle,
      origin: SessionOrigin.broski,
    );

void main() {
  late FakeContractLink link;
  late ScriptedBridge bridge;
  late ContractClient client;

  setUp(() async {
    link = FakeContractLink();
    bridge = ScriptedBridge(link);
    client = ContractClient(
      link: link,
      info: () => const ClientInfo(name: 'test', version: '1'),
    );
    await pumpEventQueue();
  });

  tearDown(() => client.dispose());

  test('backends are listed on connect, and again when one lands', () async {
    bridge.on<BackendsListRequest>(
      (request) => BackendsListResponse(
        requestId: request.requestId,
        backends: const [],
      ),
    );
    bridge.on<BackendStatusRequest>(
      (request) =>
          BackendStatusResponse(requestId: request.requestId, status: _status),
    );
    final backends = BackendsController(client);
    await pumpEventQueue();
    expect(backends.state.loaded, isTrue);
    expect(link.sent.whereType<BackendsListRequest>(), hasLength(1));
    bridge.catalog(BackendId.pi, const StatusChangedEvent(status: _status));
    await pumpEventQueue();
    expect(link.sent.whereType<BackendsListRequest>(), hasLength(2));
    backends.dispose();
  });

  test('a session list pages newest first and follows the catalog', () async {
    bridge.on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: SessionsListed(
          page: request.page.cursor == null
              ? SessionPage(items: [_row('b', 2)], nextCursor: 'p2')
              : SessionPage(items: [_row('b', 2), _row('a', 1)]),
        ),
      ),
    );
    final list = SessionListController(client, (
      backend: BackendId.codex,
      query: const SessionQuery(archived: false),
    ));
    await pumpEventQueue();
    await list.loadMore();
    List<String> ids() => [
      for (final row in list.state.rows) row.session.sessionId,
    ];
    expect(ids(), ['b', 'a'], reason: 'a row on two pages shows once');
    expect(list.state.complete, isTrue);
    bridge.catalog(BackendId.codex, SessionUpdatedEvent(summary: _row('c', 3)));
    bridge.catalog(
      BackendId.codex,
      SessionUpdatedEvent(summary: _row('x', 9, archived: true)),
    );
    bridge.catalog(BackendId.pi, SessionUpdatedEvent(summary: _row('y', 9)));
    expect(ids(), ['c', 'b', 'a']);
    bridge.catalog(
      BackendId.codex,
      SessionUpdatedEvent(summary: _row('b', 2, archived: true)),
    );
    expect(ids(), ['c', 'a'], reason: 'an archived row leaves this list');
    bridge.catalog(
      BackendId.codex,
      const SessionRemovedEvent(
        session: SessionRef(backend: BackendId.codex, sessionId: 'a'),
      ),
    );
    expect(ids(), ['c']);
    list.dispose();
  });

  test('a directory list keeps a row it holds; a new row must match', () async {
    SessionSummary at(String id, String cwd) => SessionSummary(
      session: SessionRef(backend: BackendId.codex, sessionId: id),
      cwd: cwd,
      updatedAt: 5,
      archived: false,
      status: SessionStatus.idle,
      origin: SessionOrigin.broski,
    );
    bridge.on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: SessionsListed(
          page: SessionPage(items: [at('a', '/private/work')]),
        ),
      ),
    );
    final list = SessionListController(client, (
      backend: BackendId.codex,
      query: const SessionQuery(cwd: '/work', archived: false),
    ));
    await pumpEventQueue();
    bridge.catalog(
      BackendId.codex,
      SessionUpdatedEvent(summary: at('a', '/private/work')),
    );
    bridge.catalog(
      BackendId.codex,
      SessionUpdatedEvent(summary: at('b', '/else')),
    );
    expect([for (final row in list.state.rows) row.session.sessionId], ['a']);
    list.dispose();
  });

  test('directories are read once per load, and once per reconnect even when '
      'a screen asks at the same time', () async {
    bridge.on<SessionsListRequest>(
      (request) => SessionsListResponse(
        requestId: request.requestId,
        result: const SessionsListed(
          page: SessionPage(
            items: [
              SessionSummary(
                session: SessionRef(backend: BackendId.codex, sessionId: 'a'),
                cwd: '/work',
                updatedAt: 1,
                archived: false,
                status: SessionStatus.idle,
                origin: SessionOrigin.broski,
              ),
            ],
          ),
        ),
      ),
    );
    final directories = DirectoriesController(client, BackendId.codex);
    addTearDown(directories.dispose);
    final first = await directories.load();
    expect([for (final d in first.directories) d.cwd], ['/work']);
    expect(link.sent.whereType<SessionsListRequest>(), hasLength(1));

    link
      ..down()
      ..up();
    await directories.load();
    await pumpEventQueue();
    expect(link.sent.whereType<SessionsListRequest>(), hasLength(2));
  });

  test(
    'a model list is read again when the backend says it is stale',
    () async {
      var reads = 0;
      bridge.on<ModelsListRequest>((request) {
        reads++;
        return ModelsListResponse(
          requestId: request.requestId,
          result: const ModelsListed(models: []),
        );
      });
      final container = ProviderContainer(
        overrides: [contractClientProvider.overrideWithValue(client)],
      );
      addTearDown(container.dispose);
      const key = (backend: BackendId.codex, cwd: null);
      final subscription = container.listen(modelsProvider(key), (_, _) {});
      addTearDown(subscription.close);
      expect(
        await container.read(modelsProvider(key).future),
        isA<Done<List<ModelSummary>>>(),
      );
      bridge.catalog(
        BackendId.codex,
        const CatalogInvalidatedEvent(scope: CatalogScope.models),
      );
      await container.read(modelsProvider(key).future);
      expect(reads, 2);
    },
  );
}
