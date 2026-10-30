import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/notifications/notification_tap_provider.dart';
import 'package:broski/screens/notifications/notification_tap_routing.dart';
import 'package:broski/services/notifications/notification_tap_relay.dart';
import 'package:broski/theme/theme.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/widget_rig.dart';

class _Root extends ConsumerWidget {
  const _Root();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    routeNotificationTaps(context, ref);
    return const Scaffold(body: Text('root'));
  }
}

Future<void> _pump(
  WidgetTester tester,
  WidgetRig rig,
  NotificationTapRelay relay, {
  List<Override> overrides = const [],
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        contractClientProvider.overrideWithValue(rig.client),
        notificationTapRelayProvider.overrideWithValue(relay),
        notificationTapSourceProvider.overrideWithValue(() async {}),
        ...overrides,
      ],
      child: MaterialApp(
        theme: BroskiTheme.fromOpenCodeTheme(opencodeDarkTheme),
        home: const _Root(),
      ),
    ),
  );
  await WidgetRig.settle(tester);
}

void main() {
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
      tester.element(find.byType(_Root)),
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
}
