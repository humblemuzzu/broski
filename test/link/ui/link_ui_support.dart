import 'package:broski/models/link/machine.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../link_fixtures.dart';

/// A paired machine with the fields the machine UI reads.
Machine testMachine({
  String id = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1',
  String name = 'Studio Mac',
  String? os = 'macOS 15.3',
  List<String> lan = const ['10.0.0.2:8765'],
  bool relay = true,
  DateTime? lastConnectedAt,
}) => Machine(
  id: id,
  name: name,
  os: os,
  publicBundle: patternBytes(1217),
  fingerprint: patternBytes(32, seed: 7),
  lan: lan,
  relay: relay ? Uri.parse('wss://relay.example/x') : null,
  relayToken: relay ? 'relay-token-a' : null,
  pairedAt: DateTime.utc(2026, 1, 2),
  lastConnectedAt: lastConnectedAt,
);

/// A container whose machine storage is empty, for a test to seed.
ProviderContainer linkUiContainer({List<Override> overrides = const []}) {
  FlutterSecureStorage.setMockInitialValues(<String, String>{});
  final container = ProviderContainer(overrides: overrides);
  addTearDown(container.dispose);
  return container;
}

/// Pumps [child] under the app's dark theme, on [container].
Future<void> pumpLinkUi(
  WidgetTester tester,
  ProviderContainer container,
  Widget child,
) => tester.pumpWidget(
  UncontrolledProviderScope(
    container: container,
    child: MaterialApp(
      theme: ThemeData.dark().copyWith(extensions: const [opencodeDarkTheme]),
      home: Scaffold(body: child),
    ),
  ),
);
