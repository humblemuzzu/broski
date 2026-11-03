import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/session_context.dart';
import 'package:broski/screens/agent/chat/timeline_entry.dart';
import 'package:broski/utils/format_utils.dart';

/// The session's usage as the sidebar's context section reads it, with the
/// files [diffs] says it changed.
SessionContext sidebarContext(Usage? usage, List<DiffEntry> diffs) {
  final input = usage?.inputTokens ?? 0;
  final output = usage?.outputTokens ?? 0;
  return SessionContext(
    tokens: TokenUsage(
      input: input,
      output: output,
      total: input + output,
      contextTokens: usage?.contextTokens ?? 0,
      contextWindow: usage?.contextWindow ?? kDefaultContextWindow,
      reasoning: usage?.reasoningTokens,
      cacheRead: usage?.cacheReadTokens,
      cacheWrite: usage?.cacheWriteTokens,
    ),
    cost: usage?.costUsd ?? 0,
    lsp: const [],
    modifiedFiles: [
      for (final diff in diffs)
        ModifiedFile(
          file: diff.file,
          additions: diff.additions,
          deletions: diff.deletions,
        ),
    ],
  );
}

/// Every file the tool calls of [entries] changed, nested work included,
/// the newest change of a path replacing an older one, in the order the
/// paths were first changed.
List<DiffEntry> sessionDiffsOf(Iterable<TimelineEntry> entries) {
  final byPath = <String, DiffEntry>{};
  void visit(TimelineEntry entry) {
    if (entry is! ToolEntry) return;
    final changes =
        entry.result?.result.fileChanges ?? entry.running?.fileChanges ?? [];
    for (final change in changes) {
      byPath[change.path] = DiffEntry(
        file: change.path,
        before: '',
        after: '',
        additions: change.additions ?? 0,
        deletions: change.deletions ?? 0,
        diff: change.diff,
        partId: entry.toolCallId,
        status: change.change.wire,
      );
    }
    entry.nested.forEach(visit);
  }

  entries.forEach(visit);
  return byPath.values.toList();
}
