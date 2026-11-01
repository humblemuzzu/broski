import 'dart:typed_data';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/cache/cached_kinds.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/providers/connection/link_send_failure_notice.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/link/machine_switch_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/providers/notifications/notification_tap_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/notifications/notification_tap_routing.dart';
import 'package:broski/screens/root_screen.dart';
import 'package:broski/services/link/machine_store.dart';
import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:broski/services/storage_service.dart';
import 'package:broski/theme/theme.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../agent/support/manual_clock.dart';
import '../../agent/support/memory_text_store.dart';
import '../../agent/support/widget_rig.dart';
import '../../support/fake_websocket.dart';

Machine _machine(String id) => Machine(
  id: id,
  name: id,
  publicBundle: Uint8List(4),
  fingerprint: Uint8List(32),
  lan: const [],
  pairedAt: DateTime.utc(2030),
);

/// The machines this phone is paired with when the app starts.
Future<void> _paired(
  WidgetTester tester,
  List<String> ids, {
  required String selected,
}) => tester.runAsync(() async {
  final store = MachineStore(StorageService());
  await store.save([for (final id in ids) _machine(id)]);
  await store.saveSelectedId(selected);
});

/// The app's root, as it routes taps, with the link and the old protocol's
/// connection replaced by fakes.
Future<ProviderContainer> _pump(
  WidgetTester tester,
  WidgetRig rig,
  NotificationTapRelay relay, {
  List<Override> overrides = const [],
  ManualClock? clock,
  AgentCache? cache,
}) async {
  final socket = FakeWebSocket();
  addTearDown(socket.close);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        contractClientProvider.overrideWithValue(rig.client),
        agentClockProvider.overrideWithValue(clock ?? ManualClock()),
        agentCacheProvider.overrideWithValue(cache),
        notificationTapRelayProvider.overrideWithValue(relay),
        notificationTapSourceProvider.overrideWithValue(() async {}),
        linkConnectionBootstrapProvider.overrideWith((ref) {}),
        linkSendFailureNoticeProvider.overrideWith((ref) {}),
        webSocketServiceProvider.overrideWithValue(socket),
        connectionProvider.overrideWith(
          (ref) => ConnectionNotifier(
            ref,
            ref.read(webSocketServiceProvider),
            ref.read(bridgeServiceProvider),
          ),
        ),
        ...overrides,
      ],
      child: MaterialApp(
        theme: BroskiTheme.fromOpenCodeTheme(opencodeDarkTheme),
        home: const RootScreen(),
      ),
    ),
  );
  await WidgetRig.settle(tester);
  return ProviderScope.containerOf(tester.element(find.byType(RootScreen)));
}

void main() {
  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    SharedPreferences.setMockInitialValues(<String, Object>{});
  });

  const tap = {'backend': 'pi', 'session': 'from-a-push', 'request': 'i-1'};

  testWidgets('a tap on a push for a session of the core opens its chat', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    final relay = NotificationTapRelay();
    await _pump(tester, rig, relay);
    expect(find.byType(AgentChatScreen), findsNothing);

    relay.add(tap);
    await WidgetRig.settle(tester);

    final screen = tester.widget<AgentChatScreen>(find.byType(AgentChatScreen));
    expect(
      screen.session,
      const SessionRef(backend: BackendId.pi, sessionId: 'from-a-push'),
    );
  });

  testWidgets('a local notification for a session of the core opens it too', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    final relay = NotificationTapRelay();
    await _pump(tester, rig, relay);

    relay.add('{"backend":"pi","session":"from-a-local"}');
    await WidgetRig.settle(tester);

    final screen = tester.widget<AgentChatScreen>(find.byType(AgentChatScreen));
    expect(screen.session.sessionId, 'from-a-local');
  });

  testWidgets('a tap that launched the app is acted on once the app is up', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    final relay = NotificationTapRelay()..add(tap);

    await _pump(tester, rig, relay);

    expect(find.byType(AgentChatScreen), findsOneWidget);
  });

  testWidgets('a tap waits for the bridge to list its backends', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    rig.bridge.on<BackendsListRequest>((_) => null);
    final relay = NotificationTapRelay();
    await _pump(tester, rig, relay);

    relay.add(tap);
    await WidgetRig.settle(tester);
    expect(find.byType(AgentChatScreen), findsNothing);

    rig.bridge.answer(
      BackendsListResponse(
        requestId: rig.bridge.waiting<BackendsListRequest>().requestId,
        backends: const [
          BackendDescriptor(id: BackendId.pi, capabilities: everything),
        ],
      ),
    );
    await WidgetRig.settle(tester);
    expect(find.byType(AgentChatScreen), findsOneWidget);
  });

  testWidgets('a tap for a backend the core does not serve opens nothing', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    final relay = NotificationTapRelay();
    await _pump(tester, rig, relay);

    relay.add({'backend': 'claude-code', 'session': 'old-protocol'});
    await WidgetRig.settle(tester);

    expect(find.byType(AgentChatScreen), findsNothing);
    final container = ProviderScope.containerOf(
      tester.element(find.byType(RootScreen)),
    );
    expect(container.read(pendingNotificationTapProvider), isNull);
  });

  testWidgets(
    'a tap opens one chat, however often the root rebuilds before it does',
    (tester) async {
      final rig = WidgetRig();
      addTearDown(rig.dispose);
      rig.bridge.on<BackendsListRequest>((_) => null);
      final relay = NotificationTapRelay();
      final opened = <SessionRef>[];
      await _pump(
        tester,
        rig,
        relay,
        overrides: [
          notificationSessionOpenerProvider.overrideWithValue((
            _,
            session,
          ) async {
            opened.add(session);
          }),
        ],
      );
      relay.add(tap);
      await WidgetRig.settle(tester);
      relay.add({...tap, 'request': 'i-2'});
      await WidgetRig.settle(tester);

      rig.bridge.answer(
        BackendsListResponse(
          requestId: rig.bridge.waiting<BackendsListRequest>().requestId,
          backends: const [
            BackendDescriptor(id: BackendId.pi, capabilities: everything),
          ],
        ),
      );
      await WidgetRig.settle(tester);
      await WidgetRig.settle(tester);

      expect(opened.map((session) => session.sessionId), ['from-a-push']);
    },
  );

  testWidgets('a tap for another paired machine moves the app there, then '
      'opens its session', (tester) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    await _paired(tester, ['mac-a', 'mac-b'], selected: 'mac-a');
    final relay = NotificationTapRelay();
    final moved = <String>[];
    final container = await _pump(
      tester,
      rig,
      relay,
      overrides: [
        machineSwitchProvider.overrideWith(
          (ref) => (machine) async {
            moved.add(machine.id);
            await ref.read(machinesProvider.notifier).select(machine.id);
          },
        ),
      ],
    );
    relay.add({...tap, 'machine': 'mac-b'});
    await WidgetRig.settle(tester);
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await WidgetRig.settle(tester);

    expect(moved, ['mac-b']);
    expect(container.read(machinesProvider).selectedId, 'mac-b');
    final screen = tester.widget<AgentChatScreen>(find.byType(AgentChatScreen));
    expect(screen.session.sessionId, 'from-a-push');
  });

  testWidgets('a tap for a machine no longer paired is dropped', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    final relay = NotificationTapRelay();
    final moved = <String>[];
    await _paired(tester, ['mac-a'], selected: 'mac-a');
    final container = await _pump(
      tester,
      rig,
      relay,
      overrides: [
        machineSwitchProvider.overrideWithValue((machine) async {
          moved.add(machine.id);
        }),
      ],
    );

    relay.add({...tap, 'machine': 'forgotten'});
    await WidgetRig.settle(tester);

    expect(moved, isEmpty);
    expect(find.byType(AgentChatScreen), findsNothing);
    expect(container.read(pendingNotificationTapProvider), isNull);
  });

  testWidgets('a tap made offline opens from the backends saved for the '
      'machine', (tester) async {
    final rig = WidgetRig(reachable: false);
    addTearDown(rig.dispose);
    final cache = AgentCache(MemoryTextStore());
    await cache.saveBackends(const [
      BackendDescriptor(id: BackendId.pi, capabilities: everything),
    ]);
    final relay = NotificationTapRelay();
    await _pump(tester, rig, relay, cache: cache);

    relay.add(tap);
    await WidgetRig.settle(tester);

    expect(find.byType(AgentChatScreen), findsOneWidget);
  });

  testWidgets('a tap the app cannot act on within half a minute is let go', (
    tester,
  ) async {
    final rig = WidgetRig();
    addTearDown(rig.dispose);
    rig.bridge.on<BackendsListRequest>((_) => null);
    final clock = ManualClock();
    final relay = NotificationTapRelay();
    final container = await _pump(tester, rig, relay, clock: clock);

    relay.add(tap);
    await WidgetRig.settle(tester);
    await tester.runAsync(() => clock.advance(const Duration(seconds: 29)));
    expect(container.read(pendingNotificationTapProvider), isNotNull);
    await tester.runAsync(() => clock.advance(const Duration(seconds: 1)));
    expect(container.read(pendingNotificationTapProvider), isNull);

    rig.bridge.answer(
      BackendsListResponse(
        requestId: rig.bridge.waiting<BackendsListRequest>().requestId,
        backends: const [
          BackendDescriptor(id: BackendId.pi, capabilities: everything),
        ],
      ),
    );
    await WidgetRig.settle(tester);
    expect(find.byType(AgentChatScreen), findsNothing);
  });
}
