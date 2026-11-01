import 'package:broski/agent/ui/shared/status_look.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// How a run ended, as a person reads it (contract §7, `RunOutcome`).
String outcomeText(RunOutcome outcome) => switch (outcome) {
  RunCompleted() => 'Done',
  RunAborted() => 'Stopped',
  RunErrored(:final error) => 'Failed: ${error.message}',
  RunLimited(:final limit) => switch (limit) {
    RunLimit.maxTurns => 'Stopped at the turn limit',
    RunLimit.budget => 'Stopped at the budget',
    RunLimit.outputTokens => 'Stopped at the output limit',
  },
  RunSuspended() => 'Suspended; it resumes when the backend restarts',
  RunDeferred() => 'Waiting on a deferred tool call',
};

/// A notice, compaction, model change or run end, and its colour.
(String, Color) markerText(
  TranscriptItem item,
  OpenCodeTheme theme,
) => switch (item) {
  NoticeItem(:final level, :final text) => (text, noticeColor(level, theme)),
  CompactionItem(:final tokensBefore, :final tokensAfter, :final summary) => (
    [
      'Context compacted',
      if (tokensBefore != null && tokensAfter != null)
        '$tokensBefore → $tokensAfter tokens',
      ?summary,
    ].join(' · '),
    theme.info,
  ),
  ModelChangeItem(:final modelId, :final thinking) => (
    'Model: ${[?modelId, ?thinking].join(' · ')}',
    theme.textMuted,
  ),
  RunBoundaryItem(:final outcome) => (outcomeText(outcome), theme.textMuted),
  UserMessageItem() ||
  BlockItem() ||
  ToolCallItem() ||
  ToolResultItem() ||
  ActivityItem() => throw ArgumentError.value(item, 'item', 'not a marker'),
};
