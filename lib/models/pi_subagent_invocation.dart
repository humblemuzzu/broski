import 'dart:convert';

/// Shared list of argument field names we treat as "the prompt" for a Pi
/// subagent call. The bridge extractor uses the same list (see
/// `pi-subagent-extraction.ts:KNOWN_PROMPT_FIELDS`). Kept in sync by hand —
/// they don't need to be identical but should overlap so the detail sheet
/// and the bridge preview agree on which fields to surface.
const kPiSubagentPromptFields = <String>[
  'description',
  'subject',
  'query',
  'prompt',
  'pattern',
  'task',
  'instructions',
  'goal',
  'diff_description',
  'question',
  'text',
  'input',
];

/// A single Pi subagent invocation extracted from a parent session's JSONL.
///
/// Pi subagents (Task, oracle, finder, code_review, look_at, librarian, and
/// any user-configured extension tool that spawns a child agent) don't have
/// their own session files. Their entire conversation lives as a toolCall +
/// toolResult pair inside the parent session's JSONL.
///
/// The Flutter side receives this via `pi_get_subagent_invocation` which
/// re-reads the parent JSONL and returns full, untruncated data.
class PiSubagentInvocation {
  final String toolCallId;
  final String toolName;
  final Map<String, dynamic> fullArguments;
  final List<PiSubagentContentBlock> contentBlocks;
  final bool isError;
  final int startedAtMs;
  final int? finishedAtMs;
  final int? durationMs;
  final String? parentMessageId;
  final String? parentAssistantThinking;
  final String? parentAssistantText;

  const PiSubagentInvocation({
    required this.toolCallId,
    required this.toolName,
    required this.fullArguments,
    required this.contentBlocks,
    required this.isError,
    required this.startedAtMs,
    this.finishedAtMs,
    this.durationMs,
    this.parentMessageId,
    this.parentAssistantThinking,
    this.parentAssistantText,
  });

  factory PiSubagentInvocation.fromJson(Map<String, dynamic> json) {
    final rawBlocks = json['contentBlocks'];
    final blocks = <PiSubagentContentBlock>[];
    if (rawBlocks is List) {
      for (final b in rawBlocks) {
        if (b is Map<String, dynamic>) {
          blocks.add(PiSubagentContentBlock.fromJson(b));
        } else if (b is Map) {
          blocks.add(
            PiSubagentContentBlock.fromJson(Map<String, dynamic>.from(b)),
          );
        }
      }
    }
    return PiSubagentInvocation(
      toolCallId: json['toolCallId'] as String? ?? '',
      toolName: json['toolName'] as String? ?? 'tool',
      fullArguments: _readMap(json['fullArguments']),
      contentBlocks: blocks,
      isError: json['isError'] as bool? ?? false,
      startedAtMs: (json['startedAtMs'] as num?)?.toInt() ?? 0,
      finishedAtMs: (json['finishedAtMs'] as num?)?.toInt(),
      durationMs: (json['durationMs'] as num?)?.toInt(),
      parentMessageId: json['parentMessageId'] as String?,
      parentAssistantThinking: json['parentAssistantThinking'] as String?,
      parentAssistantText: json['parentAssistantText'] as String?,
    );
  }

  /// Build a single continuous text blob from all text content blocks,
  /// useful for copying or rendering in a fallback text-only view.
  String get fullResultText {
    final buf = StringBuffer();
    for (final block in contentBlocks) {
      if (block.type == 'text' && block.text != null) {
        if (buf.isNotEmpty) buf.write('\n');
        buf.write(block.text);
      }
    }
    return buf.toString();
  }

  /// Best-effort extraction of a human-readable "prompt" string from the
  /// tool call arguments (same logic the bridge uses for list previews).
  String get promptPreview {
    for (final field in kPiSubagentPromptFields) {
      final value = fullArguments[field];
      if (value is String && value.trim().isNotEmpty) return value;
    }
    // Fallback: longest string value
    String longest = '';
    for (final value in fullArguments.values) {
      if (value is String && value.length > longest.length) longest = value;
    }
    if (longest.isNotEmpty) return longest;
    // Final fallback: JSON-encode the arguments so the user sees real JSON
    // not a Dart `{key: value}` map toString (which isn't valid JSON).
    try {
      return jsonEncode(fullArguments);
    } catch (_) {
      return fullArguments.toString();
    }
  }

  static Map<String, dynamic> _readMap(dynamic value) {
    if (value is Map<String, dynamic>) return value;
    if (value is Map) return Map<String, dynamic>.from(value);
    return const {};
  }
}

/// A single block of a Pi subagent tool result. Most blocks are of type
/// `text` with a `text` field; unknown block types are preserved as raw
/// `data` so the UI can render them as a JSON fallback.
class PiSubagentContentBlock {
  final String type;
  final String? text;
  final dynamic data;

  const PiSubagentContentBlock({required this.type, this.text, this.data});

  factory PiSubagentContentBlock.fromJson(Map<String, dynamic> json) {
    return PiSubagentContentBlock(
      type: json['type'] as String? ?? 'unknown',
      text: json['text'] as String?,
      data: json['data'],
    );
  }
}
