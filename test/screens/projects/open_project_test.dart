import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/projects/open_project.dart';
import 'package:broski/theme/theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

const _project = ProjectSummary(
  id: 'p1',
  name: 'work',
  path: '/Users/dev/work',
);

Future<(WidgetRef, BuildContext)> pumpProjectHost(
  WidgetTester tester,
  FakeWebSocket socket,
) async {
  late WidgetRef ref;
  late BuildContext hostContext;
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        webSocketServiceProvider.overrideWithValue(socket),
        connectionProvider.overrideWith(
          (ref) => ConnectionNotifier(
            ref,
            ref.read(webSocketServiceProvider),
            ref.read(bridgeServiceProvider),
          ),
        ),
      ],
      child: MaterialApp(
        theme: BroskiTheme.black(),
        home: Consumer(
          builder: (context, widgetRef, _) {
            ref = widgetRef;
            return Builder(
              builder: (innerContext) {
                hostContext = innerContext;
                return const Scaffold(body: SizedBox.shrink());
              },
            );
          },
        ),
      ),
    ),
  );
  await tester.pump();
  return (ref, hostContext);
}

void main() {
  testWidgets('OpenCode still creates an OpenCode session', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    final socket = FakeWebSocket();
    addTearDown(socket.close);
    final (ref, context) = await pumpProjectHost(tester, socket);

    unawaited(
      ref.read(agentTypeProvider.notifier).setAgentType(AgentType.opencode),
    );
    await tester.pump();
    expect(ref.read(agentTypeProvider), AgentType.opencode);

    final opened = openProjectForSelectedAgent(
      context: context,
      ref: ref,
      project: _project,
    );
    await tester.pump();

    final create = socket.sent.firstWhere((m) => m['type'] == 'create_session');
    expect(create['projectPath'], _project.path);
    socket.deliver({
      'type': 'error',
      'requestId': create['requestId'],
      'message': 'no',
    });

    await expectLater(opened, throwsA(isA<Exception>()));
  });
}
