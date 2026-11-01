import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/session/session_effects.dart';
import 'package:broski/agent/session/session_history.dart';
import 'package:broski/agent/ui/chat/timeline_entry.dart';
import 'package:broski/contract/generated/contract.dart';

/// The conversation in order (contract §8): finished history, the items of
/// runs that settled since it was read, the active run's finished items, then
/// what is still open, then this phone's prompts not echoed yet. Tool results
/// join their calls, and a subagent's work nests in the call that runs it.
List<TimelineEntry> buildTimeline(AgentSessionState state) => [
  ...buildHistoryTimeline(state.history),
  ...buildLiveTimeline(livePartsOf(state)),
];

/// What the live part of the timeline is built from.
typedef LiveParts = ({
  ActiveRun? run,
  List<RunningTool> tools,
  List<OpenBlock> blocks,
  List<QueueItem> queue,
  List<OutgoingPrompt> prompts,
});

LiveParts livePartsOf(AgentSessionState state) => (
  run: state.snapshot.run,
  tools: state.snapshot.tools,
  blocks: state.snapshot.blocks,
  queue: state.snapshot.queue,
  prompts: state.prompts,
);

/// The finished part, which changes only when the history does. A run's
/// calls, results and nested work all belong to that run, so the finished
/// part never joins anything of the live one.
List<TimelineEntry> buildHistoryTimeline(SessionHistory history) {
  final timeline = _Assembly(const {});
  history.items.forEach(timeline.addItem);
  if (history.settlingDropped > 0) {
    timeline.addTop(
      DroppedEntry(count: history.settlingDropped, where: 'settled'),
    );
  }
  history.settling.forEach(timeline.addItem);
  return timeline.entries();
}

/// The active run, what is still open, and the prompts not echoed yet.
List<TimelineEntry> buildLiveTimeline(LiveParts live) {
  final running = {for (final tool in live.tools) tool.toolCallId: tool};
  final timeline = _Assembly(running);
  final run = live.run;
  if (run != null && run.droppedItems > 0) {
    timeline.addTop(
      DroppedEntry(count: run.droppedItems, where: 'run:${run.runId}'),
    );
  }
  run?.items.forEach(timeline.addItem);
  live.tools.forEach(timeline.addRunningTool);
  for (final block in live.blocks) {
    timeline.addNested(
      block.parentToolCallId,
      BlockEntry(
        id: block.blockId,
        kind: block.kind,
        text: block.text,
        streaming: true,
      ),
    );
  }
  for (final prompt in live.prompts) {
    if (!isQueued(prompt, live.queue)) {
      timeline.addTop(PendingPromptEntry(prompt));
    }
  }
  return timeline.entries();
}

final class _Assembly {
  _Assembly(this._running);

  final Map<ToolCallId, RunningTool> _running;
  final List<_Row> _top = [];
  final Map<ToolCallId, _ToolDraft> _tools = {};

  void addTop(TimelineEntry entry) => _top.add(_Done(entry));

  void addItem(TranscriptItem item) {
    switch (item) {
      case UserMessageItem():
        addTop(UserEntry(item));
      case BlockItem():
        addNested(
          item.parentToolCallId,
          BlockEntry(
            id: item.id,
            kind: item.block,
            text: item.text,
            streaming: false,
          ),
        );
      case ToolCallItem():
        _tool(item.toolCallId, item.parentToolCallId)
          ..name = item.name
          ..title = item.title
          ..input = item.input
          ..childSession = item.childSession;
      case ToolResultItem():
        _tool(item.toolCallId, null).result = item;
      case NoticeItem() ||
          CompactionItem() ||
          ModelChangeItem() ||
          RunBoundaryItem():
        addTop(MarkerEntry(item));
      case ActivityItem():
        addTop(ActivityEntry(item));
    }
  }

  void addRunningTool(RunningTool tool) {
    if (_tools.containsKey(tool.toolCallId)) return;
    _tool(tool.toolCallId, tool.parentToolCallId)
      ..name = tool.name
      ..title = tool.title
      ..input = tool.input;
  }

  /// [entry] inside the call [parent] when it is shown, else at the top.
  void addNested(ToolCallId? parent, TimelineEntry entry) {
    final draft = parent == null ? null : _tools[parent];
    (draft?.nested ?? _top).add(_Done(entry));
  }

  _ToolDraft _tool(ToolCallId id, ToolCallId? parent) {
    final known = _tools[id];
    if (known != null) return known;
    final draft = _ToolDraft(id, _running[id]);
    _tools[id] = draft;
    final host = parent == null ? null : _tools[parent];
    (host?.nested ?? _top).add(draft);
    return draft;
  }

  List<TimelineEntry> entries() => [for (final row in _top) row.entry()];
}

/// A row while the timeline is assembled: done, or a tool call that may still
/// learn its result and nested work.
sealed class _Row {
  TimelineEntry entry();
}

final class _Done implements _Row {
  _Done(this.done);

  final TimelineEntry done;

  @override
  TimelineEntry entry() => done;
}

final class _ToolDraft implements _Row {
  _ToolDraft(this.toolCallId, this.running);

  final ToolCallId toolCallId;
  final RunningTool? running;
  String name = '';
  String? title;
  JsonValue? input;
  SessionRef? childSession;
  ToolResultItem? result;
  final List<_Row> nested = [];

  @override
  ToolEntry entry() => ToolEntry(
    toolCallId: toolCallId,
    name: name,
    title: title,
    input: running?.input ?? input,
    running: running,
    result: result,
    childSession: running?.childSession ?? childSession,
    nested: [for (final row in nested) row.entry()],
  );
}
