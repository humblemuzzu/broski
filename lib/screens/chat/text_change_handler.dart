import 'package:flutter/material.dart';

import '../../models/agent.dart';
import '../../models/file_attachment.dart';
import '../../providers/file_search_provider.dart';

/// Result of computing autocomplete state from text input.
class AutocompleteResult {
  final bool showCommand;
  final bool showFile;
  final bool showAgent;
  final bool showCustomTool;
  final String commandFilter;
  final String agentQuery;
  final String customToolQuery;
  final bool clearFileSearch;
  final String? fileSearchQuery;
  final String? fileSearchProjectPath;

  const AutocompleteResult({
    this.showCommand = false,
    this.showFile = false,
    this.showAgent = false,
    this.showCustomTool = false,
    this.commandFilter = '',
    this.agentQuery = '',
    this.customToolQuery = '',
    this.clearFileSearch = false,
    this.fileSearchQuery,
    this.fileSearchProjectPath,
  });
}

/// Compute the autocomplete state based on text input.
/// Extracted from `_ChatScreenState._onTextChanged`.
AutocompleteResult computeAutocomplete({
  required String text,
  required List<Agent> agents,
  required bool isClaudeCode,
  required String effectivePath,
  // Current state for comparison to avoid unnecessary rebuilds
  required bool currentShowCommand,
  required String currentCommandFilter,
}) {
  final isSlashCommand =
      text.startsWith('/') && text.isNotEmpty && !text.contains(' ');

  final atMatch = RegExp(r'@(\S*)$').firstMatch(text);

  if (isSlashCommand) {
    final filter = text.substring(1).toLowerCase();
    return AutocompleteResult(
      showCommand: true,
      commandFilter: filter,
      clearFileSearch: true,
    );
  } else if (atMatch != null) {
    final query = atMatch.group(1) ?? '';
    final lowerQuery = query.toLowerCase();

    // Claude Code: "@tool:" opens custom tools autocomplete
    if (isClaudeCode && lowerQuery.startsWith('tool:')) {
      return AutocompleteResult(
        showCustomTool: true,
        customToolQuery: query.length > 5 ? query.substring(5) : '',
        clearFileSearch: true,
      );
    }

    // Check if this matches any agent name
    final matchesAgent = agents.any(
      (a) =>
          a.name.toLowerCase().startsWith(lowerQuery) ||
          (a.description?.toLowerCase().contains(lowerQuery) ?? false),
    );
    final shouldShowAgents =
        query.isEmpty || (query.length <= 10 && matchesAgent);

    if (shouldShowAgents && agents.isNotEmpty) {
      return AutocompleteResult(
        showAgent: true,
        agentQuery: query,
        clearFileSearch: true,
      );
    } else {
      return AutocompleteResult(
        showFile: true,
        fileSearchQuery: query,
        fileSearchProjectPath: effectivePath,
      );
    }
  } else {
    // No autocomplete trigger
    return const AutocompleteResult(clearFileSearch: true);
  }
}

/// Handle selection of a custom tool from the autocomplete.
/// Extracted from `_ChatScreenState._handleCustomToolSelection`.
void handleCustomToolSelection({
  required TextEditingController controller,
  required String mcpToolName,
  required void Function(VoidCallback) setState,
  required void Function(bool) setShowCustomTool,
  required void Function(String) setCustomToolQuery,
}) {
  final text = controller.text;
  final newText = text.replaceFirst(RegExp(r'@\S*$'), '$mcpToolName ');
  controller.text = newText;
  controller.selection = TextSelection.collapsed(offset: newText.length);
  setState(() {
    setShowCustomTool(false);
    setCustomToolQuery('');
  });
}

/// Handle @file selection - replace @query with file attachment.
/// Extracted from `_ChatScreenState._handleFileSelection`.
void handleFileSelection({
  required TextEditingController controller,
  required FileAttachment attachment,
  required List<FileAttachment> attachedFiles,
  required FileSearchNotifier fileSearch,
  required void Function(VoidCallback) setState,
}) {
  if (attachedFiles.contains(attachment)) return;
  final text = controller.text;
  final newText = text.replaceFirst(RegExp(r'@\S*$'), '');
  controller.text = newText;
  controller.selection = TextSelection.collapsed(offset: newText.length);
  setState(() {
    attachedFiles.add(attachment);
  });
  fileSearch.clear();
}

/// Handle @agent selection - replace @query with @agentname.
/// Extracted from `_ChatScreenState._handleAgentSelection`.
void handleAgentSelection({
  required TextEditingController controller,
  required Agent agent,
  required bool isOpenCode,
  required void Function(VoidCallback) setState,
  required void Function(String?) setSelectedAgent,
}) {
  final text = controller.text;
  final newText = text.replaceFirst(RegExp(r'@\S*$'), '@${agent.name} ');
  controller.text = newText;
  controller.selection = TextSelection.collapsed(offset: newText.length);
  setState(() {
    if (isOpenCode) {
      setSelectedAgent(agent.name);
    }
  });
}

/// Insert a memory prompt template into the input.
/// Extracted from `_ChatScreenState._insertMemoryPromptTemplate`.
void insertMemoryPromptTemplate({
  required TextEditingController controller,
  required FocusNode focusNode,
  required String scope,
}) {
  final template = switch (scope) {
    'user' => 'When this is useful later, store it in user memory: ',
    'project' =>
      'If this should persist for the project, store it in project memory: ',
    'local' =>
      'If this should remain local to this machine, store it in local memory: ',
    _ => 'Store this memory appropriately: ',
  };
  final currentText = controller.text;
  final prefix = currentText.trim().isEmpty
      ? template
      : '$currentText\n$template';
  controller.text = prefix;
  controller.selection = TextSelection.collapsed(
    offset: controller.text.length,
  );
  focusNode.requestFocus();
}
