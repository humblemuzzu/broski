import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/agent/ui/chat/timeline_providers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';

final _streaming = replacing(
  emptySnapshot(),
  run: const ActiveRun(
    runId: 'r1',
    trigger: RunTrigger.prompt,
    startedAt: 1,
    items: [],
    droppedItems: 0,
  ),
  blocks: const [
    OpenBlock(blockId: 'b1', messageId: 'm1', kind: BlockKind.text, text: ''),
  ],
);

/// The timeline is built in two parts, so a streamed delta costs what the
/// live run holds, never what the whole conversation holds.
void main() {
  test('a delta rebuilds the live part only; other news rebuilds '
      'neither', () async {
    final rig = await SessionRig.start();
    addTearDown(rig.dispose);
    final container = ProviderContainer(
      overrides: [
        contractClientProvider.overrideWithValue(rig.client),
        agentClockProvider.overrideWithValue(rig.clock),
        agentCacheProvider.overrideWithValue(null),
      ],
    );
    addTearDown(container.dispose);
    rig.bridge
      ..on<SessionAttachRequest>(
        (request) => snapshotAnswer(request, snapshot: _streaming),
      )
      ..on<TranscriptReadRequest>(
        (request) => pageAnswer(request, [
          for (var index = 0; index < 300; index++) userItem('h$index'),
        ]),
      );
    final history = container.listen(
      historyTimelineProvider(sessionRef),
      (_, _) {},
    );
    final live = container.listen(liveTimelineProvider(sessionRef), (_, _) {});
    await pumpEventQueue();
    final settledHistory = history.read();
    expect(settledHistory.entries, hasLength(300));
    final before = live.read();
    rig.bridge.event(
      sessionRef,
      1,
      const BlockDeltaEvent(blockId: 'b1', text: 'Hel'),
    );
    expect(history.read(), same(settledHistory));
    expect(live.read(), isNot(same(before)));
    final afterDelta = live.read();
    rig.bridge.event(
      sessionRef,
      2,
      const UsageUpdatedEvent(usage: Usage(inputTokens: 5)),
    );
    expect(live.read(), same(afterDelta));
    expect(history.read(), same(settledHistory));
  });
}
