import 'dart:async';

import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/main_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../agent/support/widget_rig.dart';
import '../support/fake_websocket.dart';

const _selectedKey = 'broski_selected_agent_type';

/// The old protocol's side: answers no request, so nothing the shell still
/// sends it is left waiting.
class _OldBridge extends FakeWebSocket {
  @override
  bool send(Map<String, dynamic> message) {
    final sent = super.send(message);
    if (message['requestId'] case final String id) {
      scheduleMicrotask(
        () => deliver({'type': 'error', 'requestId': id, 'message': 'no'}),
      );
    }
    return sent;
  }
}

Future<void> _pump(WidgetTester tester, {required String stored}) async {
  FlutterSecureStorage.setMockInitialValues({_selectedKey: stored});
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final socket = _OldBridge();
  addTearDown(socket.close);
  final rig = WidgetRig();
  addTearDown(rig.dispose);
  await rig.pump(
    tester,
    const MainShell(),
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
  );
  await tester.pumpAndSettle();
}

int? _shownTab(WidgetTester tester) =>
    tester.widget<IndexedStack>(find.byType(IndexedStack)).index;

void main() {
  testWidgets('the app opens on the Sessions tab with the stored Claude Code', (
    tester,
  ) async {
    await _pump(tester, stored: 'claude-code');
    expect(_shownTab(tester), 2);
  });

  testWidgets('the app opens on the Sessions tab with a contract backend '
      'stored', (tester) async {
    await _pump(tester, stored: 'contract:claude-code');
    expect(_shownTab(tester), 2);
  });
}
