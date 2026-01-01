import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_highlight/flutter_highlight.dart';
import 'package:flutter_highlight/themes/atom-one-dark.dart';
import 'package:google_fonts/google_fonts.dart';

import '../models/message.dart';
import '../theme/opencode_theme.dart';
import '../theme/tool_style.dart';

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

  /// Check if this is an edit tool with diff content
  bool get _isEditWithDiff {
    final toolName = widget.tool.name.toLowerCase();
    if (toolName != 'edit' && toolName != 'patch') return false;
    final oldString = widget.tool.input['oldString'] as String? ?? '';
    final newString = widget.tool.input['newString'] as String? ?? '';
    return oldString.isNotEmpty || newString.isNotEmpty;
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    // Use ToolStyle for consistent tool-specific icons and colors
    final icon = ToolStyle.getIcon(widget.tool.name);
    final toolColor = ToolStyle.getColor(context, widget.tool.name);
    final statusColor = _getStatusColor(widget.tool.status, theme, toolColor);

    // For edit tools with diff, show inline diff preview
    if (_isEditWithDiff) {
      return _buildEditDiffCard(theme, icon, statusColor, toolColor);
    }

    // Default card for other tools
    return _buildDefaultCard(theme, icon, statusColor, toolColor);
  }

  /// Card with inline diff preview (for edit tools)
  Widget _buildEditDiffCard(
    OpenCodeTheme theme,
    IconData icon,
    Color statusColor,
    Color toolColor,
  ) {
    final fileName = _getFileName(
      widget.tool.input['filePath'] as String? ??
          widget.tool.input['path'] as String? ??
          '',
    );
    final oldString = widget.tool.input['oldString'] as String? ?? '';
    final newString = widget.tool.input['newString'] as String? ?? '';

    // Build diff lines
    final diffLines = <_DiffLine>[];
    for (final line in oldString.split('\n')) {
      if (line.isNotEmpty) diffLines.add(_DiffLine(line, isRemoved: true));
    }
    for (final line in newString.split('\n')) {
      if (line.isNotEmpty) diffLines.add(_DiffLine(line, isAdded: true));
    }

    // Count additions/removals
    final additions = newString.split('\n').where((l) => l.isNotEmpty).length;
    final removals = oldString.split('\n').where((l) => l.isNotEmpty).length;

    // Show preview lines (max 4 when collapsed)
    final previewLines = _isExpanded ? diffLines : diffLines.take(4).toList();
    final hasMore = diffLines.length > 4;

    // Determine border color based on tool color and status
    final isRunning = widget.tool.status == 'running';
    final hasError = widget.tool.status == 'error';
    final borderColor = hasError
        ? theme.error.withValues(alpha: 0.5)
        : isRunning
        ? toolColor.withValues(alpha: 0.6)
        : toolColor.withValues(alpha: 0.3);

    return GestureDetector(
      onTap: () => setState(() => _isExpanded = !_isExpanded),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(
          color: _isExpanded ? theme.bgActive : theme.bgRaised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: borderColor, width: isRunning ? 1.5 : 1.0),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header with filename and +/- stats
            Container(
              padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: toolColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Icon(icon, size: 14, color: toolColor),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      fileName,
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: theme.text,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  // +/- badges
                  if (removals > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      margin: const EdgeInsets.only(right: 4),
                      decoration: BoxDecoration(
                        color: theme.error.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        '-$removals',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: theme.error,
                        ),
                      ),
                    ),
                  if (additions > 0)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: theme.success.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        '+$additions',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: theme.success,
                        ),
                      ),
                    ),
                  const SizedBox(width: 8),
                  Icon(
                    _isExpanded
                        ? Icons.keyboard_arrow_up
                        : Icons.keyboard_arrow_down,
                    color: theme.textMuted.withValues(alpha: 0.5),
                    size: 18,
                  ),
                ],
              ),
            ),

            // Inline diff preview - always visible
            Container(
              margin: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              decoration: BoxDecoration(
                color: theme.backgroundElement,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (int i = 0; i < previewLines.length; i++)
                    _buildDiffRow(theme, previewLines[i], i + 1),
                  // "Show more" indicator
                  if (!_isExpanded && hasMore)
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      child: Text(
                        '${diffLines.length - 4} more lines...',
                        style: TextStyle(
                          fontSize: 11,
                          color: theme.textMuted.withValues(alpha: 0.6),
                        ),
                      ),
                    ),
                ],
              ),
            ),

            // Actions row (only when expanded)
            if (_isExpanded)
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                child: Row(
                  children: [
                    _buildStatusChip(
                      widget.tool.status == 'completed'
                          ? Icons.check_circle
                          : Icons.sync,
                      widget.tool.status == 'completed' ? 'Applied' : 'Running',
                      widget.tool.status == 'completed'
                          ? theme.success
                          : theme.info,
                    ),
                    const Spacer(),
                    if (_canUndo && widget.onUndo != null)
                      _buildCompactButton(
                        Icons.undo_rounded,
                        'Undo',
                        theme.warning,
                        _handleUndo,
                      ),
                    _buildCompactButton(
                      Icons.copy_rounded,
                      'Copy',
                      theme.textMuted,
                      _copyToClipboard,
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildDiffRow(OpenCodeTheme theme, _DiffLine line, int lineNum) {
    final bgColor = line.isAdded
        ? theme.success.withValues(alpha: 0.1)
        : line.isRemoved
        ? theme.error.withValues(alpha: 0.1)
        : Colors.transparent;
    final textColor = line.isAdded
        ? theme.success
        : line.isRemoved
        ? theme.error
        : theme.text.withValues(alpha: 0.8);
    final prefix = line.isAdded
        ? '+'
        : line.isRemoved
        ? '-'
        : ' ';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Line number
          SizedBox(
            width: 24,
            child: Text(
              '$lineNum',
              style: GoogleFonts.jetBrainsMono(
                fontSize: 10,
                color: theme.textMuted.withValues(alpha: 0.4),
                height: 1.4,
              ),
              textAlign: TextAlign.right,
            ),
          ),
          const SizedBox(width: 6),
          // Prefix (+/-)
          Text(
            prefix,
            style: GoogleFonts.jetBrainsMono(
              fontSize: 11,
              color: textColor.withValues(alpha: 0.7),
              height: 1.4,
            ),
          ),
          const SizedBox(width: 4),
          // Content
          Expanded(
            child: Text(
              line.text,
              style: GoogleFonts.jetBrainsMono(
                fontSize: 11,
                color: textColor,
                height: 1.4,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCompactButton(
    IconData icon,
    String label,
    Color color,
    VoidCallback onTap,
  ) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        margin: const EdgeInsets.only(left: 4),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 12, color: color),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                color: color,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Default card for non-edit tools
  Widget _buildDefaultCard(
    OpenCodeTheme theme,
    IconData icon,
    Color statusColor,
    Color toolColor,
  ) {
    // Determine border and background based on tool color and status
    final isRunning = widget.tool.status == 'running';
    final hasError = widget.tool.status == 'error';
    final borderColor = hasError
        ? theme.error.withValues(alpha: 0.5)
        : isRunning
        ? toolColor.withValues(alpha: 0.6)
        : toolColor.withValues(alpha: 0.3);

    return GestureDetector(
      onTap: () => setState(() => _isExpanded = !_isExpanded),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 0, vertical: 4),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: _isExpanded ? theme.bgActive : theme.bgRaised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: borderColor, width: isRunning ? 1.5 : 1.0),
          boxShadow: isRunning
              ? [
                  BoxShadow(
                    color: toolColor.withValues(alpha: 0.15),
                    blurRadius: 12,
                    spreadRadius: 0,
                  ),
                ]
              : null,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header - compact
            Row(
              children: [
                // Tool icon with tool-specific color
                Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: toolColor.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Icon(icon, size: 14, color: toolColor),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _getToolTitle(widget.tool),
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: theme.text,
                        ),
                      ),
                      if (!_isExpanded) ...[
                        const SizedBox(height: 2),
                        Text(
                          _getCompactSummary(widget.tool),
                          style: TextStyle(
                            fontSize: 11,
                            color: theme.textMuted.withValues(alpha: 0.6),
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
                Icon(
                  _isExpanded
                      ? Icons.keyboard_arrow_up
                      : Icons.keyboard_arrow_down,
                  color: theme.textMuted.withValues(alpha: 0.5),
                  size: 18,
                ),
              ],
            ),

            // Expanded content
            if (_isExpanded) ...[
              const SizedBox(height: 10),
              Container(
                height: 1,
                color: theme.borderSubtle.withValues(alpha: 0.5),
              ),
              const SizedBox(height: 10),

              // Code content
              if (_hasCodeContent(widget.tool)) _buildCodePreview(theme),

              // Output
              if (widget.tool.output != null && widget.tool.output!.isNotEmpty)
                _buildOutput(widget.tool.output!, theme),

              // Actions
              const SizedBox(height: 8),
              Row(
                children: [
                  if (widget.tool.status == 'completed')
                    _buildStatusChip(Icons.check_circle, 'Done', theme.success),
                  if (widget.tool.status == 'error')
                    _buildStatusChip(Icons.error, 'Failed', theme.error),
                  if (widget.tool.status == 'running')
                    _buildStatusChip(Icons.sync, 'Running', theme.info),
                  const Spacer(),
                  if (_canUndo && widget.onUndo != null)
                    _buildCompactButton(
                      Icons.undo_rounded,
                      'Undo',
                      theme.warning,
                      _handleUndo,
                    ),
                  _buildCompactButton(
                    Icons.copy_rounded,
                    'Copy',
                    theme.textMuted,
                    _copyToClipboard,
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

    final shown = _showAllCode ? codeLines : codeLines.take(5).toList();
    final preview = shown.join('\n');
    final hasMore = codeLines.length > shown.length;
    final language = _detectLanguage();
    final isComplete =
        widget.tool.status == 'completed' || widget.tool.status == 'error';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: theme.backgroundElement,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: theme.borderSubtle),
          ),
          child: isComplete
              ? HighlightView(
                  preview,
                  language: language,
                  theme: atomOneDarkTheme,
                  padding: EdgeInsets.zero,
                  textStyle: GoogleFonts.jetBrainsMono(fontSize: 11, height: 1.5),
                )
              : Text(
                  preview,
                  style: GoogleFonts.jetBrainsMono(
                    fontSize: 11,
                    height: 1.5,
                    color: theme.text,
                  ),
                ),
        ),
        if (hasMore || _showAllCode)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Center(
              child: InkWell(
                onTap: () => setState(() => _showAllCode = !_showAllCode),
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  child: Text(
                    _showAllCode
                        ? 'Show less'
                        : 'Show ${codeLines.length - shown.length} more lines →',
                    style: TextStyle(
                      color: theme.info,
                      fontSize: 12,
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
    final shown = _showAllOutput ? lines : lines.take(5).toList();
    final preview = shown.join('\n');
    final hasMore = lines.length > shown.length;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 8),
        Text(
          'Output',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: theme.textMuted.withValues(alpha: 0.7),
          ),
        ),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: theme.backgroundElement,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Text(
            preview,
            style: GoogleFonts.jetBrainsMono(
              fontSize: 11,
              color: theme.text,
              height: 1.5,
            ),
          ),
        ),
        if (hasMore || _showAllOutput)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Center(
              child: InkWell(
                onTap: () => setState(() => _showAllOutput = !_showAllOutput),
                borderRadius: BorderRadius.circular(6),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  child: Text(
                    _showAllOutput
                        ? 'Show less'
                        : 'Show ${lines.length - shown.length} more lines →',
                    style: TextStyle(
                      color: theme.info,
                      fontSize: 12,
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
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: color,
            ),
          ),
        ],
      ),
    );
  }

  // Note: Tool icon is now provided by ToolStyle.getIcon()

  Color _getStatusColor(String status, OpenCodeTheme theme, Color toolColor) {
    switch (status.toLowerCase()) {
      case 'completed':
      case 'success':
        return theme.success;
      case 'error':
      case 'failed':
        return theme.error;
      case 'running':
      case 'pending':
        // Use tool color for running state (more distinctive)
        return toolColor;
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
      case 'task':
        // Task tool is used for subagent invocation
        final subagentType = tool.input['subagent_type'] as String?;
        if (subagentType != null && subagentType.isNotEmpty) {
          return 'Subagent: $subagentType';
        }
        return 'Running subagent task';
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

  /// Compact summary - just the filename or short command
  String _getCompactSummary(ToolCall tool) {
    switch (tool.name.toLowerCase()) {
      case 'read':
      case 'edit':
      case 'write':
        final path =
            tool.input['filePath'] as String? ??
            tool.input['path'] as String? ??
            '';
        return _getFileName(path);
      case 'bash':
      case 'shell':
        final command = tool.input['command'] as String? ?? '';
        // Show first 30 chars of command
        return command.length > 30 ? '${command.substring(0, 30)}...' : command;
      case 'task':
        // Show subagent description or prompt preview
        final description = tool.input['description'] as String?;
        final prompt = tool.input['prompt'] as String? ?? '';
        if (description != null && description.isNotEmpty) {
          return description.length > 50
              ? '${description.substring(0, 50)}...'
              : description;
        }
        if (prompt.isNotEmpty) {
          return prompt.length > 50 ? '${prompt.substring(0, 50)}...' : prompt;
        }
        return 'Delegating task...';
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

/// Simple diff line model
class _DiffLine {
  final String text;
  final bool isAdded;
  final bool isRemoved;

  _DiffLine(this.text, {this.isAdded = false, this.isRemoved = false});
}
