import 'dart:convert';

import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/cache/cached_kinds.dart';
import 'package:broski/agent/catalog/directory_summary.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/manual_clock.dart';
import '../support/memory_text_store.dart';

SessionSummary _row(String id, {String? cwd, int at = 1}) => SessionSummary(
  session: SessionRef(backend: BackendId.pi, sessionId: id),
  updatedAt: at,
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.broski,
  cwd: cwd,
);

TranscriptItem _item(String id, String text) =>
    NoticeItem(id: id, at: 1, level: NoticeLevel.info, text: text);

void main() {
  late MemoryTextStore store;
  late AgentCache cache;

  setUp(() {
    store = MemoryTextStore();
    cache = AgentCache(store, clock: ManualClock(DateTime.utc(2030, 1, 1)));
  });

  const query = SessionQuery(archived: false);

  test('a session list comes back as it was saved, with when', () async {
    await cache.saveSessions(BackendId.pi, query, [_row('a'), _row('b')]);
    final saved = await cache.sessions(BackendId.pi, query);
    expect([for (final row in saved!.value) row.session.sessionId], ['a', 'b']);
    expect(saved.savedAt, DateTime.utc(2030, 1, 1).millisecondsSinceEpoch);
    expect(
      await cache.sessions(BackendId.pi, const SessionQuery(archived: true)),
      isNull,
    );
  });

  test('a transcript keeps its newest items, oldest first', () async {
    final items = [for (var i = 0; i < 300; i++) _item('i$i', 'm$i')];
    await cache.saveHistory(sessionRefOf('s'), items, IdStability.stable);
    final saved = await cache.history(sessionRefOf('s'));
    expect(saved!.value.items.length, CachedKinds.maxItems);
    expect(saved.value.items.last.id, 'i299');
    expect(saved.value.items.first.id, 'i${300 - CachedKinds.maxItems}');
  });

  test('a transcript over the entry bound loses its oldest items', () async {
    final big = 'x' * 40000;
    final items = [for (var i = 0; i < 20; i++) _item('i$i', big)];
    await cache.saveHistory(sessionRefOf('s'), items, IdStability.stable);
    final saved = await cache.history(sessionRefOf('s'));
    expect(saved!.value.items, isNotEmpty);
    expect(saved.value.items.length, lessThan(20));
    expect(saved.value.items.last.id, 'i19');
    final stored = store.entries.values.map((text) => text.length);
    expect(stored.every((size) => size <= AgentCache.maxEntryChars), isTrue);
  });

  test('the cache holds at most its entries, the oldest write going', () async {
    for (var i = 0; i < AgentCache.maxEntries + 6; i++) {
      await cache.saveSessions(
        BackendId.pi,
        SessionQuery(archived: false, cwd: '/w$i'),
        [_row('a')],
      );
    }
    expect(
      await cache.sessions(
        BackendId.pi,
        const SessionQuery(archived: false, cwd: '/w0'),
      ),
      isNull,
    );
    const newest = SessionQuery(
      archived: false,
      cwd: '/w${AgentCache.maxEntries + 5}',
    );
    expect(await cache.sessions(BackendId.pi, newest), isNotNull);
    expect(store.entries.length, AgentCache.maxEntries + 1);
  });

  test('the cache holds at most its characters in all', () async {
    final chunk = 'y' * 60000;
    for (var i = 0; i < 40; i++) {
      await cache.saveHistory(sessionRefOf('s$i'), [
        _item('i', chunk),
      ], IdStability.stable);
    }
    final total = store.entries.entries
        .where((entry) => entry.key != 'broski_agent_cache_index')
        .fold<int>(0, (sum, entry) => sum + entry.value.length);
    expect(total, lessThanOrEqualTo(AgentCache.maxChars));
    expect(await cache.history(sessionRefOf('s39')), isNotNull);
  });

  test('an entry another version wrote, or a broken one, is a miss', () async {
    await cache.saveBackends(const []);
    final key = store.entries.keys.firstWhere(
      (key) => key != 'broski_agent_cache_index',
    );
    final text = jsonDecode(store.entries[key]!) as Map<String, Object?>;
    store.entries[key] = jsonEncode({...text, 'v': 99});
    expect(await cache.backends(), isNull);
    store.entries[key] = '{not json';
    expect(await cache.backends(), isNull);
    store.entries[key] = jsonEncode({...text, 'data': 'a string'});
    expect(await cache.backends(), isNull);
  });

  test('a store that fails costs the cache, never the app', () async {
    store.failing = true;
    await cache.saveSessions(BackendId.pi, query, [_row('a')]);
    expect(await cache.sessions(BackendId.pi, query), isNull);
  });

  test('clear forgets everything it holds', () async {
    await cache.saveSessions(BackendId.pi, query, [_row('a')]);
    await cache.saveDirectories(
      BackendId.pi,
      directoriesOf([_row('a', cwd: '/w')]),
    );
    await cache.clear();
    expect(store.entries, isEmpty);
    expect(await cache.directories(BackendId.pi), isNull);
  });

  test('directories are the working directories, newest first', () {
    final directories = directoriesOf([
      _row('a', cwd: '/old', at: 1),
      _row('b', cwd: '/new', at: 9),
      _row('c', cwd: '/old', at: 5),
      _row('d', at: 100),
    ]);
    expect([for (final d in directories) d.cwd], ['/new', '/old']);
    expect(directories.last.sessions, 2);
    expect(directories.last.updatedAt, 5);
  });
}

SessionRef sessionRefOf(String id) =>
    SessionRef(backend: BackendId.pi, sessionId: id);
