import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../models/message.dart';
import '../../theme/opencode_theme.dart';
import '../../theme/tool_style.dart';
import 'detail_sheet.dart';

/// A compact card for Task/subagent tool calls and subtask notifications.
/// Shows agent name and brief description.
/// Tapping opens sheet with prompt, tool calls, and output.
class CompactAgentCard extends StatelessWidget {
  final ToolCall? _tool;
  final SubtaskNotification? _notification;
  final String? messageId;

  /// Create from a ToolCall (Task tool)
  const CompactAgentCard({super.key, required ToolCall tool, this.messageId})
    : _tool = tool,
      _notification = null;

  /// Create from a SubtaskNotification (background task completion)
  const CompactAgentCard.fromNotification({
    super.key,
    required SubtaskNotification notification,
    this.messageId,
  }) : _notification = notification,
       _tool = null;

  /// Whether this card is for a notification (vs a tool call)
  bool get _isNotification => _notification != null;

  /// Extract agent type
  String get _agentType {
    if (_isNotification) {
      return _notification?.agent ?? 'general';
    }
    // Task tool input has 'subagent_type' or 'name' field
    return _tool!.input['subagent_type'] as String? ??
        _tool!.input['name'] as String? ??
        'general';
  }

  /// Extract description
  String get _description {
    if (_isNotification) {
      return _notification!.description;
    }
    return _tool!.input['description'] as String? ?? '';
  }

  /// Extract prompt
  String get _prompt {
    if (_isNotification) {
      return _notification!.prompt ?? '';
    }
    return _tool!.input['prompt'] as String? ?? '';
  }

  /// Get status string
  String get _status {
    if (_isNotification) {
      return _notification!.isCompleted ? 'completed' : 'running';
    }
    return _tool!.status;
  }

  /// Get output
  String? get _output {
    if (_isNotification) {
      // Notifications don't have output, but we can show duration
      final duration = _notification!.duration;
      if (duration != null) {
        return 'Completed in ${duration}s';
      }
      return 'Completed';
    }
    return _tool!.output;
  }

  /// Get agent-specific icon
  IconData _getAgentIcon() {
    switch (_agentType.toLowerCase()) {
      case 'explore':
        return Icons.search_rounded;
      case 'code-reviewer':
        return Icons.rate_review_rounded;
      case 'test-writer':
        return Icons.science_rounded;
      case 'refactor-expert':
        return Icons.construction_rounded;
      case 'general':
        return Icons.auto_awesome_rounded;
      case 'librarian':
        return Icons.menu_book_rounded;
      case 'oracle':
        return Icons.psychology_rounded;
      default:
        return Icons.smart_toy_rounded;
    }
  }

  /// Get agent-specific color
  Color _getAgentColor(OpenCodeTheme theme) {
    switch (_agentType.toLowerCase()) {
      case 'explore':
        return theme.info;
      case 'code-reviewer':
        return theme.warning;
      case 'test-writer':
        return theme.success;
      case 'refactor-expert':
        return theme.accent;
      case 'librarian':
        return theme.toolRead;
      case 'oracle':
        return theme.toolThinking;
      default:
        return theme.info;
    }
  }

  String _capitalize(String s) {
    if (s.isEmpty) return s;
    return s[0].toUpperCase() + s.substring(1);
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final isRunning = _status == 'running';
    final isError = _status == 'error';
    final agentColor = _getAgentColor(theme);

    return GestureDetector(
      onTap: () => _showDetailSheet(context),
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 2),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isRunning
                ? agentColor.withValues(alpha: 0.4)
                : theme.cardBorderSubtle,
            width: isRunning ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            // Agent icon
            Icon(
              _getAgentIcon(),
              size: 16,
              color: isError ? theme.error : agentColor,
            ),
            const SizedBox(width: 6),

            // Agent type name (bold)
            Text(
              _capitalize(_agentType),
              style: TextStyle(
                color: theme.text,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 8),

            // Description as preview (muted, truncated)
            Expanded(
              child: Text(
                _description.isNotEmpty ? _description : _prompt,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: theme.textMuted, fontSize: 12),
              ),
            ),
            const SizedBox(width: 8),

            // Running spinner or chevron
            if (isRunning)
              SizedBox(
                width: 14,
                height: 14,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(agentColor),
                ),
              )
            else
              Icon(
                Icons.chevron_right,
                size: 18,
                color: theme.textMuted.withValues(alpha: 0.5),
              ),
          ],
        ),
      ),
    );
  }

  void _showDetailSheet(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final isRunning = _status == 'running';

    // Try to parse nested tool calls from output (only for tool calls)
    final nestedTools = _isNotification
        ? <Map<String, String>>[]
        : _parseNestedToolCalls();

    DetailSheet.show(
      context: context,
      title: _capitalize(_agentType),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Prompt section
          if (_prompt.isNotEmpty)
            DetailSection(
              label: 'Prompt',
              child: SelectableText(
                _prompt,
                style: TextStyle(color: theme.text, fontSize: 13),
              ),
            ),

          // Tool calls section (if any)
          if (nestedTools.isNotEmpty)
            DetailSection(
              label: 'Tool calls (${nestedTools.length})',
              child: Column(
                children: nestedTools
                    .map(
                      (t) => _NestedToolRow(
                        toolName: t['name'] ?? 'unknown',
                        preview: t['preview'] ?? '',
                      ),
                    )
                    .toList(),
              ),
            ),

          // Output section - rendered with markdown like main chat
          DetailSection(
            label: 'Output',
            child: isRunning
                ? Row(
                    children: [
                      SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: theme.info,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'Running...',
                        style: TextStyle(color: theme.textMuted),
                      ),
                    ],
                  )
                : MarkdownBody(
                    data: _output ?? 'No output',
                    selectable: true,
                    styleSheet: _buildMarkdownStyle(theme),
                  ),
          ),
        ],
      ),
    );
  }

  /// Build markdown style matching the main chat
  MarkdownStyleSheet _buildMarkdownStyle(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      p: GoogleFonts.inter(fontSize: 14, color: theme.text, height: 1.5),
      h1: GoogleFonts.inter(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h2: GoogleFonts.inter(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h3: GoogleFonts.inter(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      strong: TextStyle(fontWeight: FontWeight.w600, color: theme.text),
      em: TextStyle(fontStyle: FontStyle.italic, color: theme.textMuted),
      code: GoogleFonts.jetBrainsMono(
        fontSize: 12,
        color: theme.accent,
        backgroundColor: theme.backgroundElement,
      ),
      codeblockDecoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: theme.borderSubtle),
      ),
      codeblockPadding: const EdgeInsets.all(12),
      blockquoteDecoration: BoxDecoration(
        border: Border(left: BorderSide(color: theme.borderSubtle, width: 3)),
      ),
      blockquotePadding: const EdgeInsets.only(left: 12),
      listBullet: TextStyle(color: theme.textMuted),
      tableHead: TextStyle(fontWeight: FontWeight.w600, color: theme.text),
      tableBody: TextStyle(color: theme.text),
      tableBorder: TableBorder.all(color: theme.borderSubtle, width: 1),
      tableCellsPadding: const EdgeInsets.all(8),
    );
  }

  /// Parse nested tool calls from the agent output (if structured)
  List<Map<String, String>> _parseNestedToolCalls() {
    // The tool output might contain structured data about nested calls
    // This is a simplified version - adjust based on actual output format
    // For now, return empty list if we can't parse
    try {
      final output = _tool?.output;
      if (output == null) return [];

      // If output contains tool call information, parse it
      // This is format-dependent - adjust as needed
      return [];
    } catch (e) {
      return [];
    }
  }
}

/// A row displaying a nested tool call within the agent detail sheet
class _NestedToolRow extends StatelessWidget {
  final String toolName;
  final String preview;

  const _NestedToolRow({required this.toolName, required this.preview});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(
            ToolStyle.getIcon(toolName),
            size: 14,
            color: ToolStyle.getColor(context, toolName),
          ),
          const SizedBox(width: 8),
          Text(
            _capitalize(toolName),
            style: TextStyle(
              color: theme.text,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              preview,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: theme.textMuted, fontSize: 11),
            ),
          ),
        ],
      ),
    );
  }

  String _capitalize(String s) {
    if (s.isEmpty) return s;
    return s[0].toUpperCase() + s.substring(1);
  }
}
