import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart';
import 'package:broski/screens/agent/chat/timeline_entry.dart';

/// [entry] in the shape the app's compact tool cards draw: the input as a
/// map, one of the three status words they colour, the output as text, and
/// the unified diff of what it changed. The calls a subagent made inside it,
/// at any depth, are listed for the agent card.
ToolCall chatToolCall(ToolEntry entry) {
  final changes = toolFileChanges(entry);
  final diff = [for (final change in changes) ?change.diff].join('\n');
  final nested = _nestedCalls(entry).toList();
  return ToolCall(
    callId: entry.toolCallId,
    partId: entry.toolCallId,
    name: entry.name.isEmpty ? 'Tool' : entry.name,
    status: chatToolStatus(entry),
    title: entry.title,
    input: _inputMap(entry.input),
    output: chatToolOutput(entry),
    metadata: {
      if (diff.isNotEmpty) 'diff': diff,
      if (nested.isNotEmpty) ...{
        'nestedToolCount': nested.length,
        'nestedToolCalls': [
          for (final call in nested)
            {
              'name': call.name,
              'title': ?call.title,
              'status': chatToolStatus(call),
              'output': chatToolOutput(call),
            },
        ],
      },
    },
  );
}

/// The files [entry] changed, as it reported them so far.
List<FileChange> toolFileChanges(ToolEntry entry) =>
    entry.result?.result.fileChanges ??
    entry.running?.fileChanges ??
    const <FileChange>[];

Iterable<ToolEntry> _nestedCalls(ToolEntry entry) sync* {
  for (final nested in entry.nested.whereType<ToolEntry>()) {
    yield nested;
    yield* _nestedCalls(nested);
  }
}

/// `running`, `completed` or `error`.
String chatToolStatus(ToolEntry entry) => switch (entry.result?.outcome) {
  null => 'running',
  ToolOutcome.completed => 'completed',
  ToolOutcome.failed || ToolOutcome.denied || ToolOutcome.aborted => 'error',
};

/// What the call printed so far; once it ended, what it returned and why it
/// did not complete.
String? chatToolOutput(ToolEntry entry) {
  final result = entry.result;
  if (result == null) {
    final output = entry.running?.output ?? '';
    return output.isEmpty ? null : output;
  }
  final parts = [
    for (final content in result.result.content)
      if (content case TextContent(:final text) when text.isNotEmpty) text,
    if (result.outcome == ToolOutcome.denied) 'Denied',
    if (result.outcome == ToolOutcome.aborted) 'Stopped',
    ?result.result.error,
    if (result.result.exitCode case final code? when code != 0)
      'Exit code $code',
  ];
  return parts.isEmpty ? null : parts.join('\n');
}

Map<String, dynamic> _inputMap(JsonValue? input) => switch (input?.toJson()) {
  final Map<String, Object?> map => Map<String, dynamic>.of(map),
  null => const {},
  final Object other => {'input': other},
};
