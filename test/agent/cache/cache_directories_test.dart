import 'dart:io';
import 'dart:typed_data';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/cache/cache_directories.dart';
import 'package:broski/agent/cache/cached_kinds.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

const _query = SessionQuery(archived: false);

SessionSummary _row(String id) => SessionSummary(
  session: SessionRef(backend: BackendId.pi, sessionId: id),
  updatedAt: 1,
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.broski,
);

Machine _machine(String id) => Machine(
  id: id,
  name: id,
  publicBundle: Uint8List(4),
  fingerprint: Uint8List(32),
  lan: const [],
  pairedAt: DateTime.utc(2030, 1, 1),
);

Future<List<String>> _listed(AgentCache? cache) async => [
  for (final row
      in (await cache?.sessions(BackendId.pi, _query))?.value ??
          const <SessionSummary>[])
    row.session.sessionId,
];

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late Directory root;
  late CacheDirectories directories;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    root = await Directory.systemTemp.createTemp('agent-cache-');
    directories = CacheDirectories(() async => root);
  });

  tearDown(() async {
    if (await root.exists()) await root.delete(recursive: true);
  });

  AgentCache cacheOf(String machine) =>
      AgentCache(directories.storeFor(machine));

  test('a machine reads only what was saved for it', () async {
    await cacheOf('mac-a').saveSessions(BackendId.pi, _query, [_row('a1')]);
    await cacheOf('mac/b').saveSessions(BackendId.pi, _query, [_row('b1')]);
    expect(await _listed(cacheOf('mac-a')), ['a1']);
    expect(await _listed(cacheOf('mac/b')), ['b1']);
    expect(await _listed(cacheOf('mac-c')), isEmpty);
  });

  test('forgetting a machine removes its cache and no other', () async {
    await cacheOf('mac-a').saveSessions(BackendId.pi, _query, [_row('a1')]);
    await cacheOf('mac-b').saveSessions(BackendId.pi, _query, [_row('b1')]);
    await directories.forget('mac-a');
    expect(await _listed(cacheOf('mac-a')), isEmpty);
    expect(await _listed(cacheOf('mac-b')), ['b1']);
  });

  test('clearing the cache removes every machine\'s', () async {
    await cacheOf('mac-a').saveSessions(BackendId.pi, _query, [_row('a1')]);
    await cacheOf('mac-b').saveSessions(BackendId.pi, _query, [_row('b1')]);
    await directories.clearAll();
    expect(await root.exists(), isFalse);
    expect(await _listed(cacheOf('mac-b')), isEmpty);
    await cacheOf('mac-a').saveSessions(BackendId.pi, _query, [_row('a2')]);
    expect(await _listed(cacheOf('mac-a')), ['a2']);
  });

  test('the app\'s cache is the chosen machine\'s, and forgetting a machine '
      'removes it', () async {
    final container = ProviderContainer(
      overrides: [cacheDirectoriesProvider.overrideWithValue(directories)],
    );
    addTearDown(container.dispose);
    final machines = container.read(machinesProvider.notifier);
    expect(container.read(agentCacheProvider), isNull);
    await machines.add(_machine('mac-a'));
    await machines.add(_machine('mac-b'));
    await container.read(agentCacheProvider)!.saveSessions(
      BackendId.pi,
      _query,
      [_row('a1')],
    );
    await machines.select('mac-b');
    expect(await _listed(container.read(agentCacheProvider)), isEmpty);
    await machines.select('mac-a');
    expect(await _listed(container.read(agentCacheProvider)), ['a1']);
    await machines.remove('mac-a');
    expect(await _listed(cacheOf('mac-a')), isEmpty);
  });
}
