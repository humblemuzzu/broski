import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/theme.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_contract_link.dart';
import 'manual_clock.dart';
import 'scripted_bridge.dart';
import 'session_fixtures.dart';

const everything = Capabilities(
  streamText: true,
  streamThinking: true,
  promptModes: [PromptMode.start, PromptMode.steer, PromptMode.queue],
  attachments: [AttachmentKind.image, AttachmentKind.file],
  mentions: [MentionKind.file, MentionKind.agent],
  commands: true,
  queue: true,
  interactions: InteractionKind.values,
  modelSwitch: ModelSwitchTiming.nextRequest,
  thinking: true,
  children: true,
  usage: true,
  plan: true,
  planProposals: true,
  externalLive: true,
  durableRuns: true,
  extensions: ExtensionKind.values,
  backendOps: [BackendOpKind.reviewStart, BackendOpKind.revertStage],
  fork: true,
  rename: true,
  delete: true,
  archive: true,
);

const nothing = Capabilities(
  streamText: false,
  streamThinking: false,
  promptModes: [PromptMode.start],
  attachments: [],
  mentions: [],
  commands: false,
  queue: false,
  interactions: [],
  modelSwitch: ModelSwitchTiming.nextRun,
  thinking: false,
  children: false,
  usage: false,
  plan: false,
  planProposals: false,
  externalLive: false,
  durableRuns: false,
  extensions: [],
  backendOps: [],
  fork: false,
  rename: false,
  delete: false,
  archive: false,
);

/// A widget under test, over a real contract client and session store whose
/// bridge the test scripts. Created inside `testWidgets`: nothing here waits
/// on a real timer.
final class WidgetRig {
  WidgetRig({
    Capabilities capabilities = everything,
    SessionSnapshot? snapshot,
    SessionCapabilities session = controllable,
  }) : link = FakeContractLink() {
    bridge = ScriptedBridge(link)
      ..on<BackendsListRequest>(
        (request) => BackendsListResponse(
          requestId: request.requestId,
          backends: [
            BackendDescriptor(
              id: sessionRef.backend,
              capabilities: capabilities,
            ),
          ],
        ),
      )
      ..on<SessionAttachRequest>(
        (request) => snapshotAnswer(
          request,
          snapshot: snapshot ?? emptySnapshot(),
          capabilities: session,
        ),
      )
      ..on<TranscriptReadRequest>((request) => pageAnswer(request, []))
      ..on<SessionGetRequest>(
        (request) => SessionGetResponse(
          requestId: request.requestId,
          result: const SessionFound(summary: summary),
        ),
      );
    client = ContractClient(
      link: link,
      info: () => const ClientInfo(name: 'test', version: '1'),
      clock: ManualClock(),
    );
  }

  final FakeContractLink link;
  late final ScriptedBridge bridge;
  late final ContractClient client;

  Future<void> pump(WidgetTester tester, Widget home) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [contractClientProvider.overrideWithValue(client)],
        child: MaterialApp(
          theme: BroskiTheme.fromOpenCodeTheme(opencodeDarkTheme),
          home: home,
        ),
      ),
    );
    await settle(tester);
  }

  /// Lets every answer the scripted bridge gave land. A running session
  /// spins a progress indicator, which never lets `pumpAndSettle` finish.
  static Future<void> settle(WidgetTester tester) async {
    for (var frame = 0; frame < 10; frame++) {
      await tester.pump();
    }
  }

  T sent<T extends ClientMessage>() => link.sent.whereType<T>().last;

  void dispose() => client.dispose();
}
