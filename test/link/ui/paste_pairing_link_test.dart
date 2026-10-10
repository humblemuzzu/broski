import 'package:broski/models/link/machine.dart';
import 'package:broski/models/link/pairing_failure.dart';
import 'package:broski/models/link/pending_pairing.dart';
import 'package:broski/screens/scan/paste_pairing_link.dart';
import 'package:broski/services/link/machine_bundle_fetcher.dart';
import 'package:broski/services/link/pairing_input.dart';
import 'package:broski/services/link/pairing_service.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../link_fixtures.dart';
import 'link_ui_support.dart';

/// Records the offer the pairing flow was handed, then refuses it.
class _RecordingPairing extends PairingService {
  _RecordingPairing(Ref ref) : super(ref, MachineBundleFetcher());

  final pairings = <PendingPairing>[];

  @override
  Future<Machine> pair(PendingPairing pending) async {
    pairings.add(pending);
    throw const PairingTimeoutFailure('The machine did not confirm.');
  }
}

String pairingLink({required int expiresAt}) => v2PairUri(
  fingerprint: patternBytes(32, seed: 3),
  secret: patternBytes(32, seed: 4),
  expiresAt: expiresAt,
  name: 'Headless Mac',
  lan: const ['10.0.0.2:8765'],
);

int secondsFromNow(Duration offset) =>
    DateTime.now().add(offset).millisecondsSinceEpoch ~/ 1000;

void mockClipboard(String? text) {
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .setMockMethodCallHandler(SystemChannels.platform, (call) async {
        if (call.method == 'Clipboard.getData') {
          return text == null ? null : <String, dynamic>{'text': text};
        }
        return null;
      });
}

Future<void> pumpButton(WidgetTester tester, {VoidCallback? onDismiss}) async {
  final container = linkUiContainer();
  await pumpLinkUi(
    tester,
    container,
    PastePairingLinkButton(onDismiss: onDismiss ?? () {}),
  );
}

Future<void> tapAndSettle(WidgetTester tester) async {
  await tester.tap(find.byType(PastePairingLinkButton));
  await tester.pump();
  await tester.pump();
}

void main() {
  testWidgets('a clipboard that is not a pairing link says so', (tester) async {
    mockClipboard('hello world');

    await pumpButton(tester);
    expect(find.byTooltip('Paste pairing link'), findsOneWidget);

    await tapAndSettle(tester);

    expect(find.text('That is not a pairing link.'), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
  });

  testWidgets('an empty clipboard says so', (tester) async {
    mockClipboard('');

    await pumpButton(tester);
    await tapAndSettle(tester);

    expect(find.text('The clipboard is empty.'), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();

    mockClipboard(null);
    await tapAndSettle(tester);

    expect(find.text('The clipboard is empty.'), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
  });

  testWidgets('an expired pairing link reports its expiry', (tester) async {
    mockClipboard(
      pairingLink(expiresAt: secondsFromNow(-const Duration(hours: 1))),
    );

    await pumpButton(tester);
    await tapAndSettle(tester);

    expect(find.textContaining('expired'), findsOneWidget);
    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
  });

  testWidgets('a pairing link starts the flow a scanned QR starts', (
    tester,
  ) async {
    final link = pairingLink(
      expiresAt: secondsFromNow(const Duration(minutes: 5)),
    );
    mockClipboard(link);
    final expected = parsePairingInput(link, DateTime.now())!;
    late _RecordingPairing pairing;

    final container = linkUiContainer(
      overrides: [
        pairingServiceProvider.overrideWith((ref) {
          return pairing = _RecordingPairing(ref);
        }),
      ],
    );
    await pumpLinkUi(
      tester,
      container,
      PastePairingLinkButton(onDismiss: () {}),
    );

    await tapAndSettle(tester);
    await tester.pump();

    expect(pairing.pairings.single.machineId, expected.machineId);
    expect(pairing.pairings.single.name, 'Headless Mac');
    expect(find.text('The machine did not confirm.'), findsOneWidget);
  });
}
