import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../models/card_style.dart';
import '../../models/message.dart';
import '../../providers/card_style_provider.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../theme/tool_style.dart';
import 'detail_sheet.dart';

/// A compact card for Task/subagent tool calls and subtask notifications.
/// Shows agent name and brief description.
/// Tapping opens sheet with prompt, tool calls, and output.
class CompactAgentCard extends ConsumerWidget {
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
    final tool = _tool;
    if (tool == null) return 'general';
    // Task tool input has 'subagent_type' or 'name' field
    return tool.input['subagent_type'] as String? ??
        tool.input['name'] as String? ??
        'general';
  }

  /// Extract description
  String get _description {
    if (_isNotification) {
      return _notification!.description;
    }
    final tool = _tool;
    if (tool == null) return '';
    return tool.input['description'] as String? ?? '';
  }

  /// Extract prompt
  String get _prompt {
    if (_isNotification) {
      return _notification!.prompt ?? '';
    }
    final tool = _tool;
    if (tool == null) return '';
    return tool.input['prompt'] as String? ?? '';
  }

  /// Get status string
  String get _status {
    if (_isNotification) {
      return _notification!.isCompleted ? 'completed' : 'running';
    }
    final tool = _tool;
    if (tool == null) return 'running';
    return tool.status;
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
    return _tool?.output;
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
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final cardStyle = ref.watch(cardStyleProvider);
    final isRunning = _status == 'running';
    final isError = _status == 'error';
    final agentColor = _getAgentColor(theme);

    // Determine colors based on card style settings
    final Color headerBg;
    final Color borderColor;

    switch (cardStyle.headerStyle) {
      case CardHeaderStyle.solid:
        headerBg = theme.cardHeaderBg;
      case CardHeaderStyle.tinted:
        headerBg = agentColor.withValues(alpha: 0.1);
      case CardHeaderStyle.minimal:
        headerBg = theme.bgRaised;
    }

    switch (cardStyle.borderVisibility) {
      case CardBorderVisibility.subtle:
        borderColor = theme.cardBorderSubtle;
      case CardBorderVisibility.visible:
        borderColor = theme.cardHeaderBorder;
      case CardBorderVisibility.accent:
        borderColor = agentColor.withValues(alpha: 0.5);
    }

    return GestureDetector(
      onTap: () => _showDetailSheet(context),
      child: Container(
        margin: EdgeInsets.symmetric(vertical: Spacing.xxs),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isRunning ? agentColor.withValues(alpha: 0.4) : borderColor,
            width: isRunning ? 1.5 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Container(
          padding: EdgeInsets.symmetric(horizontal: Spacing.md, vertical: 10),
          decoration: BoxDecoration(
            color: headerBg,
            borderRadius: BorderRadius.circular(11),
          ),
          child: Row(
            children: [
              // Agent icon
              Icon(
                _getAgentIcon(),
                size: 16,
                color: isError ? theme.error : agentColor,
              ),
              SizedBox(width: 6),

              // Agent type name (bold)
              Text(
                _capitalize(_agentType),
                style: TextStyle(
                  color: theme.cardHeaderText,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              SizedBox(width: Spacing.sm),

              // Description as preview (muted, truncated)
              Expanded(
                child: Text(
                  _description.isNotEmpty ? _description : _prompt,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
              ),

              // Nested tool count badge (when tool has nested calls)
              if (!_isNotification &&
                  (_tool?.metadata['nestedToolCount'] is int))
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 5,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: agentColor.withValues(alpha: 0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '${_tool!.metadata['nestedToolCount']} tools',
                      style: TextStyle(
                        color: agentColor,
                        fontSize: 10,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),

              SizedBox(width: Spacing.xxs),

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

          if (nestedTools.isNotEmpty)
            Padding(
              padding: EdgeInsets.only(bottom: Spacing.sm),
              child: Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => _showFullActivitySheet(context, nestedTools),
                  icon: const Icon(Icons.unfold_more_rounded, size: 16),
                  label: const Text('Full activity'),
                ),
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
                      SizedBox(width: Spacing.sm),
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

  void _showFullActivitySheet(
    BuildContext context,
    List<Map<String, String>> nestedTools,
  ) {
    final theme = OpenCodeTheme.of(context);
    DetailSheet.show(
      context: context,
      title: 'Agent Activity',
      initialSize: 0.75,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (int i = 0; i < nestedTools.length; i++) ...[
            if (i > 0)
              Divider(color: theme.borderSubtle.withValues(alpha: 0.35)),
            SizedBox(height: Spacing.sm),
            Row(
              children: [
                Icon(
                  ToolStyle.getIcon(nestedTools[i]['name'] ?? 'tool'),
                  color: ToolStyle.getColor(
                    context,
                    nestedTools[i]['name'] ?? 'tool',
                  ),
                  size: 14,
                ),
                SizedBox(width: Spacing.sm),
                Expanded(
                  child: Text(
                    _capitalize(nestedTools[i]['name'] ?? 'tool'),
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                Text(
                  (nestedTools[i]['status'] ?? 'completed').toUpperCase(),
                  style: TextStyle(
                    color: theme.textMuted,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.backgroundPanel,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: theme.borderSubtle, width: 1),
              ),
              child: SelectableText(
                (nestedTools[i]['output'] ?? '').isNotEmpty
                    ? nestedTools[i]['output']!
                    : (nestedTools[i]['preview'] ?? ''),
                style: TextStyle(color: theme.text, fontSize: 12, height: 1.4),
              ),
            ),
            SizedBox(height: 6),
          ],
        ],
      ),
    );
  }

  /// Build markdown style matching the main chat
  MarkdownStyleSheet _buildMarkdownStyle(OpenCodeTheme theme) {
    return MarkdownStyleSheet(
      p: TextStyle(fontFamily: 'GeistSans', fontSize: 14, color: theme.text, height: 1.5),
      h1: TextStyle(
        fontFamily: 'GeistSans',
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h2: TextStyle(
        fontFamily: 'GeistSans',
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: theme.text,
        height: 1.4,
      ),
      h3: TextStyle(
        fontFamily: 'GeistSans',
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
      codeblockPadding: Insets.card,
      blockquoteDecoration: BoxDecoration(
        border: Border(left: BorderSide(color: theme.borderSubtle, width: 3)),
      ),
      blockquotePadding: EdgeInsets.only(left: Spacing.md),
      listBullet: TextStyle(color: theme.textMuted),
      tableHead: TextStyle(fontWeight: FontWeight.w600, color: theme.text),
      tableBody: TextStyle(color: theme.text),
      tableBorder: TableBorder.all(color: theme.borderSubtle, width: 1),
      tableCellsPadding: EdgeInsets.all(Spacing.sm),
    );
  }

  /// Parse nested tool calls from tool metadata (populated by chat_provider)
  List<Map<String, String>> _parseNestedToolCalls() {
    try {
      final metadata = _tool?.metadata;
      if (metadata == null) return [];

      // Read from metadata['nestedToolCalls'] populated by chat_provider
      final nestedRaw = metadata['nestedToolCalls'];
      if (nestedRaw is List) {
        return nestedRaw
            .whereType<Map>()
            .map(
              (t) => {
                'name': (t['name'] ?? 'unknown').toString(),
                'status': (t['status'] ?? 'completed').toString(),
                'preview': t['output'] != null
                    ? t['output'].toString().length > 80
                          ? '${t['output'].toString().substring(0, 80)}...'
                          : t['output'].toString()
                    : '',
                'output': t['output']?.toString() ?? '',
              },
            )
            .toList();
      }

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
      padding: Insets.chipV,
      child: Row(
        children: [
          Icon(
            ToolStyle.getIcon(toolName),
            size: 14,
            color: ToolStyle.getColor(context, toolName),
          ),
          SizedBox(width: Spacing.sm),
          Text(
            _capitalize(toolName),
            style: TextStyle(
              color: theme.text,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
          SizedBox(width: Spacing.sm),
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
