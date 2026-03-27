import 'package:flutter/material.dart';

import '../../models/message.dart';
import '../../models/todo.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/compact_agent_card.dart';
import '../../widgets/chat/compact_edit_card.dart';
import '../../widgets/chat/compact_tool_card.dart';
import '../../widgets/chat/compact_todos_card.dart';
import '../../widgets/chat/compact_write_card.dart';
import '../../widgets/chat/message_helpers.dart';

/// Builds the appropriate compact card for a tool call.
/// Extracted from `_ChatScreenState._buildToolCard`.
Widget buildToolCard({
  required ToolCall tool,
  required String messageId,
  required bool isClaudeCode,
  required bool isCodex,
  required Future<void> Function(String, {String? partId}) onRevert,
}) {
  final toolName = tool.name.toLowerCase().replaceFirst('mcp_', '');
  // Edit/Patch tools -> CompactEditCard
  if (isEditTool(toolName)) {
    return CompactEditCard(
      tool: tool,
      messageId: messageId,
      onUndo: isClaudeCode || isCodex
          ? null
          : (msgId, partId) => onRevert(msgId, partId: partId),
    );
  }
  // Write tool -> CompactWriteCard
  if (toolName == 'write') {
    return CompactWriteCard(
      tool: tool,
      messageId: messageId,
      onUndo: isClaudeCode
          ? null
          : (msgId, partId) => onRevert(msgId, partId: partId),
    );
  }
  // Task/subtask/agent tool -> CompactAgentCard
  if (toolName == 'task' || toolName == 'subtask' || toolName == 'agent') {
    return CompactAgentCard(tool: tool, messageId: messageId);
  }
  // TodoWrite tool -> CompactTodosCard
  if (toolName == 'todowrite') {
    final todos = extractTodosFromTool(tool);
    if (todos.isNotEmpty) {
      return CompactTodosCard(todos: todos);
    }
  }
  // All other tools -> CompactToolCard
  return CompactToolCard(
    tool: tool,
    messageId: messageId,
    onUndo: canUndoTool(toolName)
        ? (msgId, partId) => onRevert(msgId, partId: partId)
        : null,
  );
}

/// Build a patch card with compact file list.
/// Extracted from `_ChatScreenState._buildPatchCard`.
Widget buildPatchCard(BuildContext context, List<String> files) {
  final theme = OpenCodeTheme.of(context);
  return Container(
    padding: const EdgeInsets.all(8),
    decoration: BoxDecoration(
      color: theme.bgRaised,
      borderRadius: BorderRadius.circular(8),
      border: Border.all(color: theme.borderSubtle),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '📝 Patched ${files.length} file${files.length != 1 ? 's' : ''}',
          style: TextStyle(
            color: theme.text,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: 4),
        for (final file in files)
          Padding(
            padding: const EdgeInsets.only(top: 1),
            child: Text(
              file,
              style: TextStyle(
                color: theme.textMuted,
                fontSize: 11,
                fontFamily: 'monospace',
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
    ),
  );
}

/// Agent indicator pill badge.
/// Extracted from `_ChatScreenState._buildAgentPill`.
Widget buildAgentPill(BuildContext context, String agentName) {
  final theme = OpenCodeTheme.of(context);
  return Align(
    alignment: Alignment.centerLeft,
    child: Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: theme.accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        '🤖 $agentName',
        style: TextStyle(
          color: theme.accent,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    ),
  );
}

/// Extract todos from TodoWrite tool input.
List<Todo> extractTodosFromTool(ToolCall tool) {
  try {
    final todosRaw = tool.input['todos'];
    if (todosRaw is! List) return [];
    return todosRaw
        .whereType<Map<String, dynamic>>()
        .map((t) => Todo.fromJson(t))
        .toList();
  } catch (e) {
    return [];
  }
}

/// Check if a tool can be undone (write operations).
bool canUndoTool(String toolName) {
  return toolName == 'write';
}
