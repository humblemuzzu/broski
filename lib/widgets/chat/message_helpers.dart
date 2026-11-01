import 'package:broski/models/message.dart';

/// Check if a tool is an edit tool (lowercased tool name).
bool isEditTool(String toolName) {
  return toolName == 'edit' ||
      toolName == 'multiedit' ||
      toolName == 'str_replace_editor' ||
      toolName == 'str_replace' ||
      toolName == 'file_editor';
}

/// Check if a tool is a file modification tool (edit, write, patch).
/// These tools produce diffs that are shown inline in their compact cards.
bool isFileModificationTool(String toolName) {
  return isEditTool(toolName) ||
      toolName == 'write' ||
      toolName == 'create' ||
      toolName == 'touch';
}

/// Check if a diff came from a file modification tool (to avoid duplicate display).
/// File tools and diffs represent the same changes,
/// so we hide diffs when file modification tools are present.
bool isDiffFromEditTool(DiffEntry diff, List<ToolCall> tools) {
  return tools.any((t) {
    final name = t.name.toLowerCase().replaceFirst('mcp_', '');
    return isFileModificationTool(name);
  });
}

/// Whether an assistant message contains any file-modifying tool calls.
bool messageHasFileChanges(ChatMessage message) {
  return message.toolCalls.any((t) {
    final name = t.name.toLowerCase().replaceFirst('mcp_', '');
    return isFileModificationTool(name);
  });
}

/// Extract file paths from file-modifying tool calls in a message.
/// Uses the same field-name heuristics as CompactEditCard._getFilePath().
List<String> extractChangedFilePaths(ChatMessage message) {
  final paths = <String>{};
  for (final tool in message.toolCalls) {
    final name = tool.name.toLowerCase().replaceFirst('mcp_', '');
    if (!isFileModificationTool(name)) continue;
    final path =
        tool.input['filePath'] as String? ??
        tool.input['path'] as String? ??
        tool.input['file_path'] as String? ??
        tool.input['file'] as String?;
    if (path != null && path.isNotEmpty) {
      paths.add(path);
    }
  }
  return paths.toList();
}
