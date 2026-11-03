import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart';
import 'package:broski/screens/agent/chat/chat_rows.dart';
import 'package:broski/screens/agent/chat/chat_tool_call.dart';
import 'package:broski/screens/agent/chat/timeline_entry.dart';
import 'package:flutter_test/flutter_test.dart';

BlockEntry _block(String id, BlockKind kind, {bool streaming = false}) =>
    BlockEntry(id: id, kind: kind, text: 'text $id', streaming: streaming);

ToolEntry _tool(
  String id, {
  String name = 'bash',
  ToolOutcome? outcome,
  List<FileChange> changes = const [],
  List<TimelineEntry> nested = const [],
  List<ToolContent> content = const [],
  String? error,
  int? exitCode,
}) => ToolEntry(
  toolCallId: id,
  name: name,
  input: const JsonObject({'command': JsonString('ls')}),
  result: outcome == null
      ? null
      : ToolResultItem(
          id: 'r$id',
          toolCallId: id,
          outcome: outcome,
          result: ToolResult(
            content: content,
            fileChanges: changes,
            error: error,
            exitCode: exitCode,
          ),
        ),
  nested: nested,
);

const _question = UserEntry(
  UserMessageItem(id: 'u1', text: 'Fix it', attachments: []),
);

void main() {
  group('chatRowsOf', () {
    test('blocks and tools between two other rows make one turn, in order', () {
      final rows = chatRowsOf([
        _question,
        _block('b1', BlockKind.thinking),
        _block('b2', BlockKind.text),
        _tool('t1'),
        _block('b3', BlockKind.text),
      ]);
      expect(rows, hasLength(2));
      expect((rows.first as EntryRow).entry, same(_question));
      final turn = rows.last as TurnRow;
      expect(turn.message.reasoningParts.single.text, 'text b1');
      expect(turn.message.parts.map((part) => part.runtimeType), [
        TextPart,
        ToolPart,
        TextPart,
      ]);
      expect(turn.message.toolCalls.single.callId, 't1');
      expect(turn.text, 'text b2\n\ntext b3');
      expect(turn.firstBlockId, 'b1');
      expect(turn.lastBlockId, 'b3');
    });

    test('thinking after other work starts the next turn', () {
      final rows = chatRowsOf([
        _block('b1', BlockKind.text),
        _block('b2', BlockKind.thinking),
        _block('b3', BlockKind.text),
      ]);
      expect(rows, hasLength(2));
      expect((rows.last as TurnRow).firstBlockId, 'b2');
    });

    test('a turn keeps its key while its text streams', () {
      String keyOf(bool streaming) => chatRowsOf([
        _block('b1', BlockKind.text, streaming: streaming),
      ]).single.key;
      expect(keyOf(true), keyOf(false));
      final streaming =
          chatRowsOf([_block('b1', BlockKind.text, streaming: true)]).single
              as TurnRow;
      expect(streaming.message.isStreaming, isTrue);
    });

    test('a proposed plan reads as one in the message', () {
      final turn = chatRowsOf([_block('p', BlockKind.plan)]).single as TurnRow;
      expect(
        (turn.message.parts.single as TextPart).text,
        startsWith('**Proposed plan**'),
      );
      expect(turn.text, 'text p');
    });

    test('every other entry is a row of its own and ends the turn', () {
      final rows = chatRowsOf([
        _block('b1', BlockKind.text),
        const DroppedEntry(count: 2, where: 'run:r1'),
        _block('b2', BlockKind.text),
      ]);
      expect(rows.map((row) => row.runtimeType), [TurnRow, EntryRow, TurnRow]);
    });
  });

  group('chatToolCall', () {
    test('maps every outcome to the three words the cards colour', () {
      expect(chatToolCall(_tool('t')).status, 'running');
      expect(
        chatToolCall(_tool('t', outcome: ToolOutcome.completed)).status,
        'completed',
      );
      for (final outcome in [
        ToolOutcome.failed,
        ToolOutcome.denied,
        ToolOutcome.aborted,
      ]) {
        expect(
          chatToolCall(_tool('t', outcome: outcome)).status,
          'error',
          reason: outcome.wire,
        );
      }
    });

    test('says what the call returned and why it did not complete', () {
      final call = chatToolCall(
        _tool(
          't',
          outcome: ToolOutcome.failed,
          content: const [TextContent(text: 'no such file')],
          error: 'exited',
          exitCode: 2,
        ),
      );
      expect(call.output, 'no such file\nexited\nExit code 2');
      expect(call.input, {'command': 'ls'});
      expect(
        chatToolCall(_tool('t', outcome: ToolOutcome.denied)).output,
        'Denied',
      );
    });

    test('carries the diff of what it changed for the edit card', () {
      final call = chatToolCall(
        _tool(
          't',
          name: 'edit',
          outcome: ToolOutcome.completed,
          changes: const [
            FileChange(
              path: 'a.dart',
              change: FileChangeKind.modified,
              diff: '-a\n+b',
            ),
          ],
        ),
      );
      expect(call.metadata['diff'], '-a\n+b');
    });

    test('lists the calls a subagent made, at any depth, by their names', () {
      final call = chatToolCall(
        _tool(
          'task',
          name: 'task',
          nested: [
            _tool(
              'n1',
              name: 'read',
              nested: [
                _tool('n2', name: 'grep', outcome: ToolOutcome.completed),
              ],
            ),
            _block('nb', BlockKind.text),
          ],
        ),
      );
      expect(call.metadata['nestedToolCount'], 2);
      final nested = call.metadata['nestedToolCalls'] as List<Object?>;
      expect(
        [for (final item in nested) (item! as Map)['name']],
        ['read', 'grep'],
      );
    });
  });
}
