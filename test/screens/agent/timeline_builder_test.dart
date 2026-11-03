import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/session_history.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/timeline_builder.dart';
import 'package:broski/screens/agent/chat/timeline_entry.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';

const _noResult = ToolResult(content: [], fileChanges: []);

OutgoingPrompt _prompt(String id, PromptMode mode, {String? queueItemId}) =>
    OutgoingPrompt(
      input: PromptInput(
        clientRequestId: id,
        mode: mode,
        text: id,
        attachments: const [],
        mentions: const [],
      ),
      delivery: PromptTaken(
        PromptAccepted(
          disposition: PromptDisposition.queued,
          queueItemId: queueItemId,
        ),
      ),
    );

void main() {
  test('history, settled runs, the live run, then what is still open', () {
    final history = const SessionHistory()
        .withNewestPage(
          TranscriptPage(
            items: [userItem('h1')],
            idStability: IdStability.stable,
          ),
        )
        .withSettledRun(
          ActiveRun(
            runId: 'r0',
            trigger: RunTrigger.prompt,
            startedAt: 1,
            items: [userItem('s1')],
            droppedItems: 2,
          ),
        );
    const snapshot = SessionSnapshot(
      run: ActiveRun(
        runId: 'r1',
        trigger: RunTrigger.prompt,
        startedAt: 2,
        droppedItems: 1,
        items: [
          UserMessageItem(id: 'u1', text: 'go', attachments: []),
          ToolCallItem(id: 't1', toolCallId: 't1', name: 'task'),
          ToolCallItem(
            id: 't2',
            toolCallId: 't2',
            name: 'read',
            parentToolCallId: 't1',
          ),
          ToolResultItem(
            id: 't2:result',
            toolCallId: 't2',
            outcome: ToolOutcome.completed,
            result: _noResult,
          ),
        ],
      ),
      blocks: [
        OpenBlock(
          blockId: 'b1',
          messageId: 'm1',
          kind: BlockKind.text,
          text: 'sub',
          parentToolCallId: 't1',
        ),
        OpenBlock(
          blockId: 'b2',
          messageId: 'm2',
          kind: BlockKind.text,
          text: 'top',
        ),
      ],
      tools: [
        RunningTool(
          toolCallId: 't1',
          name: 'task',
          output: 'busy',
          fileChanges: [],
        ),
        RunningTool(
          toolCallId: 't9',
          name: 'orphan',
          output: '',
          fileChanges: [],
        ),
      ],
      interactions: [],
      queue: [
        QueueItem(id: 'q1', delivery: QueuedDelivery.queue, preview: 'p1'),
      ],
      modes: [],
    );
    final state = AgentSessionState(
      ref: sessionRef,
      snapshot: snapshot,
      history: history,
      prompts: [
        _prompt('p1', PromptMode.queue, queueItemId: 'q1'),
        _prompt('p2', PromptMode.queue),
      ],
    );
    final keys = [for (final entry in buildTimeline(state)) entry.key];
    expect(keys, [
      'user:h1',
      'dropped:settled',
      'user:s1',
      'dropped:run:r1',
      'user:u1',
      'tool:t1',
      'tool:t9',
      'block:b2',
      'prompt:p2',
    ]);
    final task = buildTimeline(state).whereType<ToolEntry>().first;
    expect(task.running?.output, 'busy');
    expect(
      [for (final entry in task.nested) entry.key],
      ['tool:t2', 'block:b1'],
    );
    final read = task.nested.whereType<ToolEntry>().single;
    expect(read.result?.outcome, ToolOutcome.completed);
  });

  test('an empty session has an empty timeline', () {
    expect(
      buildTimeline(
        AgentSessionState(ref: sessionRef, snapshot: emptySnapshot()),
      ),
      isEmpty,
    );
  });
}
