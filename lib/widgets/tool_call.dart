import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';
import '../theme/opencode_theme.dart';

class ToolCallCard extends StatefulWidget {
  const ToolCallCard({
    super.key,
    required this.tool,
    this.onUndo,
    this.messageId,
  });

  final ToolCall tool;

  /// Callback for Feature 7: Undo/Revert changes made by this tool
  final void Function(String messageId, String? partId)? onUndo;

  /// Message ID this tool belongs to (needed for undo)
  final String? messageId;

  @override
  State<ToolCallCard> createState() => _ToolCallCardState();
}

class _ToolCallCardState extends State<ToolCallCard> {
  bool _isExpanded = false;
  bool _showAllCode = false;
  bool _showAllOutput = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final icon = _getToolIcon(widget.tool.name);
    final statusColor = _getStatusColor(widget.tool.status, theme);

    return GestureDetector(
      onTap: () => setState(() => _isExpanded = !_isExpanded),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
        margin: const EdgeInsets.symmetric(horizontal: 0, vertical: 6),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(color: theme.borderSubtle, width: 1),
          boxShadow: widget.tool.status == 'running'
              ? [
                  BoxShadow(
                    color: statusColor.withValues(alpha: 0.15),
                    blurRadius: 16,
                    spreadRadius: 0,
                  ),
                ]
              : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(
                    color: statusColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 18, color: statusColor),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _getToolTitle(widget.tool),
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: theme.text,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        _getToolSummary(widget.tool),
                        style: TextStyle(fontSize: 13, color: theme.textMuted),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
                Icon(
                  _isExpanded
                      ? Icons.keyboard_arrow_up
                      : Icons.keyboard_arrow_down,
                  color: theme.textMuted,
                  size: 22,
                ),
              ],
            ),

            // Expanded content
            if (_isExpanded) ...[
              const SizedBox(height: 14),
              Container(height: 1, color: theme.borderSubtle),
              const SizedBox(height: 14),

              // Code content
              if (_hasCodeContent(widget.tool)) _buildCodePreview(theme),

              // Output
              if (widget.tool.output != null && widget.tool.output!.isNotEmpty)
                _buildOutput(widget.tool.output!, theme),

              // Actions
              const SizedBox(height: 10),
              Row(
                children: [
                  if (widget.tool.status == 'completed')
                    _buildStatusChip(
                      Icons.check_circle,
                      'Completed',
                      theme.success,
                    ),
                  if (widget.tool.status == 'error')
                    _buildStatusChip(Icons.error, 'Failed', theme.error),
                  if (widget.tool.status == 'running')
                    _buildStatusChip(Icons.sync, 'Running', theme.info),
                  const Spacer(),
                  // Feature 7: Undo button for edit/write tools
                  if (_canUndo && widget.onUndo != null)
                    TextButton.icon(
                      onPressed: _handleUndo,
                      icon: Icon(
                        Icons.undo_rounded,
                        size: 14,
                        color: theme.warning,
                      ),
                      label: Text(
                        'Undo',
                        style: TextStyle(fontSize: 13, color: theme.warning),
                      ),
                    ),
                  TextButton.icon(
                    onPressed: _copyToClipboard,
                    icon: Icon(Icons.copy, size: 14, color: theme.textMuted),
                    label: Text(
                      'Copy',
                      style: TextStyle(fontSize: 13, color: theme.textMuted),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildCodePreview(OpenCodeTheme theme) {
    final codeLines = _getCodeLines();
    if (codeLines.isEmpty) return const SizedBox.shrink();

    final shown = _showAllCode ? codeLines : codeLines.take(6).toList();
    final preview = shown.join('\n');
    final hasMore = codeLines.length > shown.length;
    final language = _detectLanguage();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: theme.backgroundElement,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: theme.borderSubtle),
          ),
          child: HighlightView(
            preview,
            language: language,
            theme: atomOneDarkTheme,
            padding: EdgeInsets.zero,
            textStyle: GoogleFonts.jetBrainsMono(fontSize: 12, height: 1.6),
          ),
        ),
        if (hasMore || _showAllCode)
          Padding(
            padding: const EdgeInsets.only(top: 10),
            child: Center(
              child: InkWell(
                onTap: () => setState(() => _showAllCode = !_showAllCode),
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  child: Text(
                    _showAllCode
                        ? 'Show less'
                        : 'Show ${codeLines.length - shown.length} more lines →',
                    style: TextStyle(
                      color: theme.info,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildOutput(String output, OpenCodeTheme theme) {
    final lines = output.split('\n');
    final shown = _showAllOutput ? lines : lines.take(6).toList();
    final preview = shown.join('\n');
    final hasMore = lines.length > shown.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 10),
        Text(
          'Output',
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: theme.textMuted,
          ),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: theme.backgroundElement,
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Text(
            preview,
            style: GoogleFonts.jetBrainsMono(
              fontSize: 12,
              color: theme.text,
              height: 1.6,
            ),
          ),
        ),
        if (hasMore || _showAllOutput)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Center(
              child: InkWell(
                onTap: () => setState(() => _showAllOutput = !_showAllOutput),
                borderRadius: BorderRadius.circular(8),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  child: Text(
                    _showAllOutput
                        ? 'Show less'
                        : 'Show ${lines.length - shown.length} more lines →',
                    style: TextStyle(
                      color: theme.info,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildStatusChip(IconData icon, String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 5),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  IconData _getToolIcon(String toolName) {
    switch (toolName.toLowerCase()) {
      case 'read':
        return Icons.description_outlined;
      case 'edit':
        return Icons.edit_outlined;
      case 'write':
        return Icons.note_add_outlined;
      case 'bash':
      case 'shell':
        return Icons.terminal;
      case 'glob':
      case 'search':
        return Icons.search;
      case 'task':
        return Icons.psychology_outlined;
      default:
        return Icons.extension_outlined;
    }
  }

  Color _getStatusColor(String status, OpenCodeTheme theme) {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'success':
        return theme.success;
      case 'error':
      case 'failed':
        return theme.error;
      case 'running':
      case 'pending':
        return theme.info;
      default:
        return theme.textMuted;
    }
  }

  String _getToolTitle(ToolCall tool) {
    if (tool.title != null && tool.title!.isNotEmpty) {
      return tool.title!;
    }

    switch (tool.name.toLowerCase()) {
      case 'read':
        final path =
            tool.input['path'] as String? ??
            tool.input['filePath'] as String? ??
            '';
        return 'Reading ${_getFileName(path)}';
      case 'edit':
        final path =
            tool.input['filePath'] as String? ??
            tool.input['path'] as String? ??
            '';
        return 'Editing ${_getFileName(path)}';
      case 'write':
        final path =
            tool.input['filePath'] as String? ??
            tool.input['path'] as String? ??
            '';
        return 'Writing ${_getFileName(path)}';
      case 'bash':
      case 'shell':
        return 'Running command';
      default:
        return tool.name;
    }
  }

  String _getToolSummary(ToolCall tool) {
    switch (tool.name.toLowerCase()) {
      case 'read':
        final path =
            tool.input['path'] as String? ??
            tool.input['filePath'] as String? ??
            '';
        return path.isEmpty ? 'Reading file' : path;
      case 'edit':
        final path =
            tool.input['filePath'] as String? ??
            tool.input['path'] as String? ??
            '';
        return path.isEmpty ? 'Editing file' : path;
      case 'write':
        final path =
            tool.input['filePath'] as String? ??
            tool.input['path'] as String? ??
            '';
        return path.isEmpty ? 'Writing file' : path;
      case 'bash':
      case 'shell':
        final command = tool.input['command'] as String? ?? '';
        return command.isEmpty ? 'Running command' : command;
      default:
        return tool.status;
    }
  }

  String _getFileName(String path) {
    if (path.isEmpty) return 'file';
    final parts = path.split('/');
    return parts.last;
  }

  bool _hasCodeContent(ToolCall tool) {
    final content = tool.input['content'] as String? ?? '';
    final oldString = tool.input['oldString'] as String? ?? '';
    final newString = tool.input['newString'] as String? ?? '';
    return content.isNotEmpty || oldString.isNotEmpty || newString.isNotEmpty;
  }

  List<String> _getCodeLines() {
    final content = widget.tool.input['content'] as String? ?? '';
    if (content.isNotEmpty) {
      return content.split('\n');
    }

    final oldString = widget.tool.input['oldString'] as String? ?? '';
    final newString = widget.tool.input['newString'] as String? ?? '';
    if (oldString.isNotEmpty || newString.isNotEmpty) {
      final lines = <String>[];
      if (oldString.isNotEmpty) {
        for (final line in oldString.split('\n')) {
          lines.add('- $line');
        }
      }
      if (newString.isNotEmpty) {
        for (final line in newString.split('\n')) {
          lines.add('+ $line');
        }
      }
      return lines;
    }

    return [];
  }

  String _detectLanguage() {
    final path =
        widget.tool.input['filePath'] as String? ??
        widget.tool.input['path'] as String? ??
        '';
    if (path.endsWith('.dart')) return 'dart';
    if (path.endsWith('.ts') || path.endsWith('.js')) return 'typescript';
    if (path.endsWith('.py')) return 'python';
    if (path.endsWith('.java')) return 'java';
    if (path.endsWith('.json')) return 'json';
    if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml';
    if (path.endsWith('.md')) return 'markdown';
    return 'plaintext';
  }

  void _copyToClipboard() {
    final content =
        widget.tool.input['content'] as String? ?? widget.tool.output ?? '';
    if (content.isNotEmpty) {
      Clipboard.setData(ClipboardData(text: content));
      final theme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Copied to clipboard'),
          behavior: SnackBarBehavior.floating,
          backgroundColor: theme.backgroundPanel,
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  // Feature 7: Check if this tool can be undone (edit/write tools that are completed)
  bool get _canUndo {
    final toolName = widget.tool.name.toLowerCase();
    final isEditTool =
        toolName == 'edit' || toolName == 'write' || toolName == 'patch';
    final isCompleted = widget.tool.status == 'completed';
    return isEditTool && isCompleted && widget.messageId != null;
  }

  // Feature 7: Handle undo action
  void _handleUndo() {
    if (widget.onUndo != null && widget.messageId != null) {
      widget.onUndo!(widget.messageId!, widget.tool.partId);
    }
  }
}
