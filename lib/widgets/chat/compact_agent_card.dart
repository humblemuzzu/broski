import 'package:broski/models/agent_type.dart';
import 'package:broski/models/card_style.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/session.dart';
import 'package:broski/models/session_context.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/card_style_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/markdown_styles.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/theme/tool_style.dart';
import 'package:broski/widgets/chat/adaptive_markdown_body.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

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

  /// Get subagent session ID (from notification or tool metadata)
  String? get _subagentSessionId {
    if (_isNotification) {
      final sid = _notification!.sessionId;
      return sid.isNotEmpty ? sid : null;
    }
    // Tool call may have session_id in metadata (populated by runtime handler)
    final meta = _tool?.metadata;
    if (meta == null) return null;
    return meta['subagentSessionId'] as String? ?? meta['sessionId'] as String?;
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
        return AppIcons.search;
      case 'code-reviewer':
        return AppIcons.rateReview;
      case 'test-writer':
        return AppIcons.science;
      case 'refactor-expert':
        return AppIcons.construction;
      case 'general':
        return AppIcons.autoAwesome;
      case 'librarian':
        return AppIcons.menuBook;
      case 'oracle':
        return AppIcons.psychology;
      default:
        return AppIcons.agent;
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
        margin: const EdgeInsets.symmetric(vertical: Spacing.xxs),
        decoration: BoxDecoration(
          color: theme.bgRaised,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isRunning ? agentColor.withValues(alpha: 0.4) : borderColor,
            width: isRunning ? 1.5 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: Spacing.md,
            vertical: 10,
          ),
          decoration: BoxDecoration(color: headerBg, borderRadius: Radii.brMd),
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
                  color: theme.cardHeaderText,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(width: Spacing.sm),
              // Description as preview (muted, truncated)
              Expanded(
                child: Text(
                  _description.isNotEmpty ? _description : _prompt,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.label(color: theme.textMuted),
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
                      borderRadius: Radii.brSm,
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
              const SizedBox(width: Spacing.xxs),
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
                  AppIcons.chevronRight,
                  size: 18,
                  color: theme.textMuted.withValues(alpha: 0.5),
                ),
            ],
          ),
        ),
      ),
    );
  }

  /// Extract step-level token usage from tool metadata (populated by chat_provider).
  Map<String, dynamic>? get _stepTokens {
    final meta = _tool?.metadata;
    if (meta == null) return null;
    return meta['stepTokens'] as Map<String, dynamic>?;
  }

  double get _stepCost {
    return (_tool?.metadata['stepCost'] as num?)?.toDouble() ?? 0;
  }

  void _showDetailSheet(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final isRunning = _status == 'running';
    // Try to parse nested tool calls from output (only for tool calls)
    final nestedTools = _isNotification
        ? <Map<String, String>>[]
        : _parseNestedToolCalls();
    final tokens = _stepTokens;
    final cost = _stepCost;
    DetailSheet.show(
      context: context,
      title: _capitalize(_agentType),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Token usage section (from associated StepFinishPart)
          if (tokens != null || cost > 0)
            _TokenUsageSection(tokens: tokens, cost: cost),
          // Prompt section
          if (_prompt.isNotEmpty)
            DetailSection(
              label: 'Prompt',
              child: SelectableText(
                _prompt,
                style: AppTypography.bodySmall(color: theme.text),
              ),
            ),
          if (nestedTools.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: Spacing.sm),
              child: Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: () => _showFullActivitySheet(context, nestedTools),
                  icon: const Icon(AppIcons.unfoldMore, size: 16),
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
                      const SizedBox(width: Spacing.sm),
                      Text(
                        'Running...',
                        style: TextStyle(color: theme.textMuted),
                      ),
                    ],
                  )
                : AdaptiveMarkdownBody(
                    data: _output ?? 'No output',
                    selectable: true,
                    styleSheet: _buildMarkdownStyle(theme),
                    onTapLink: (_, href, __) {
                      if (href != null) {
                        launchUrl(
                          Uri.parse(href),
                          mode: LaunchMode.externalApplication,
                        );
                      }
                    },
                  ),
          ),
          // View full session button (when subagent has a session ID)
          if (_subagentSessionId != null)
            _ViewFullSessionButton(
              sessionId: _subagentSessionId!,
              agentType: _agentType,
              cwd: _isNotification
                  ? ''
                  : (_tool?.input['cwd'] as String? ?? ''),
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
            const SizedBox(height: Spacing.sm),
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
                const SizedBox(width: Spacing.sm),
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
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: Insets.cardXs,
              decoration: BoxDecoration(
                color: theme.backgroundPanel,
                borderRadius: Radii.brMd,
                border: Border.all(color: theme.borderSubtle, width: 1),
              ),
              child: SelectableText(
                (nestedTools[i]['output'] ?? '').isNotEmpty
                    ? nestedTools[i]['output']!
                    : (nestedTools[i]['preview'] ?? ''),
                style: TextStyle(color: theme.text, fontSize: 12, height: 1.4),
              ),
            ),
            const SizedBox(height: 6),
          ],
        ],
      ),
    );
  }

  /// Build markdown style matching the main chat
  MarkdownStyleSheet _buildMarkdownStyle(OpenCodeTheme theme) =>
      MarkdownStyles.compact(theme);

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
          const SizedBox(width: Spacing.sm),
          Text(
            _capitalize(toolName),
            style: TextStyle(
              color: theme.text,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              preview,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.caption(color: theme.textMuted),
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

/// Compact token usage display for the subagent detail sheet.
class _TokenUsageSection extends StatelessWidget {
  const _TokenUsageSection({this.tokens, this.cost = 0});
  final Map<String, dynamic>? tokens;
  final double cost;

  /// Unified formatter — delegates to TokenUsage.formatTokenCount.
  String _fmt(int count) => TokenUsage.formatTokenCount(count);

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final input = tokens?['input'] as int? ?? 0;
    final output = tokens?['output'] as int? ?? 0;
    final reasoning = tokens?['reasoning'] as int? ?? 0;
    final total = tokens?['total'] as int? ?? 0;
    final cacheRead = tokens?['cacheRead'] as int? ?? 0;
    final cacheWrite = tokens?['cacheWrite'] as int? ?? 0;

    return Padding(
      padding: const EdgeInsets.only(bottom: Spacing.md),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: theme.backgroundElement.withValues(alpha: 0.5),
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(AppIcons.dataUsage, size: 14, color: theme.textMuted),
                const SizedBox(width: 6),
                Text(
                  'Token Usage',
                  style: TextStyle(
                    color: theme.textMuted,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.3,
                  ),
                ),
                const Spacer(),
                if (cost > 0)
                  Text(
                    '\$${cost.toStringAsFixed(4)}',
                    style: TextStyle(
                      color: theme.warning,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              runSpacing: 4,
              children: [
                if (total > 0)
                  _TokenChip(
                    label: 'Total',
                    value: _fmt(total),
                    color: theme.text,
                  ),
                if (input > 0)
                  _TokenChip(
                    label: 'In',
                    value: _fmt(input),
                    color: theme.info,
                  ),
                if (output > 0)
                  _TokenChip(
                    label: 'Out',
                    value: _fmt(output),
                    color: theme.success,
                  ),
                if (reasoning > 0)
                  _TokenChip(
                    label: 'Think',
                    value: _fmt(reasoning),
                    color: theme.accent,
                  ),
                if (cacheRead > 0)
                  _TokenChip(
                    label: 'Cache↓',
                    value: _fmt(cacheRead),
                    color: theme.textMuted,
                  ),
                if (cacheWrite > 0)
                  _TokenChip(
                    label: 'Cache↑',
                    value: _fmt(cacheWrite),
                    color: theme.textMuted,
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _TokenChip extends StatelessWidget {
  const _TokenChip({
    required this.label,
    required this.value,
    required this.color,
  });
  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '$label ',
          style: TextStyle(
            color: theme.textMuted,
            fontSize: 11,
            fontWeight: FontWeight.w500,
          ),
        ),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

/// Backend-aware "View Full Session" button for subagent detail sheets.
/// Navigates to the appropriate ChatScreen constructor based on the active backend.
///
/// Uses the current chat session's ID as the parent session ID (for CC subagents)
/// and passes `readOnly: true` for subagent transcripts that can't be resumed.
class _ViewFullSessionButton extends ConsumerWidget {
  const _ViewFullSessionButton({
    required this.sessionId,
    required this.agentType,
    required this.cwd,
  });

  final String sessionId;
  final String agentType;
  final String cwd;

  String _capitalize(String s) =>
      s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);

    return Padding(
      padding: const EdgeInsets.only(top: Spacing.md),
      child: SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: () {
            Navigator.pop(context); // close detail sheet
            _navigateToSession(context, ref);
          },
          icon: Icon(AppIcons.openExternal, size: 16, color: theme.info),
          label: Text(
            'View Full Session',
            style: TextStyle(
              color: theme.info,
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          style: OutlinedButton.styleFrom(
            side: BorderSide(color: theme.info.withValues(alpha: 0.4)),
            shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
            padding: const EdgeInsets.symmetric(vertical: 12),
          ),
        ),
      ),
    );
  }

  void _navigateToSession(BuildContext context, WidgetRef ref) {
    final backend = ref.read(agentTypeProvider);
    final chatState = ref.read(chatSessionProvider);
    final parentSessionId = chatState.effectiveSessionId ?? '';
    final title = _capitalize(agentType);
    Widget screen;

    switch (backend) {
      case AgentType.claudeCode:
        // CC subagent: sessionId is the agent ID (e.g. "agent-abc123").
        // The parent session ID comes from the active chat session.
        screen = ChatScreen.claudeCode(
          ccSession: ClaudeCodeSession(
            id: sessionId,
            cwd: cwd,
            createdAt: 0,
            updatedAt: 0,
            title: title,
            isBackground: true,
            subagentName: agentType,
            parentSessionId: parentSessionId,
          ),
          readOnly: true,
        );
      case AgentType.opencode:
        // OC subagents are real sessions — they can be opened directly.
        final session = SessionSummary(
          id: sessionId,
          title: title,
          projectID: '',
          directory: cwd,
          parentID: '',
          time: const SessionTime(created: 0, updated: 0),
        );
        final project = ProjectSummary(
          id: '',
          name:
              cwd.split('/').where((p) => p.isNotEmpty).lastOrNull ?? 'Project',
          path: cwd,
        );
        screen = ChatScreen(project: project, session: session);
      case AgentType.codex:
        // Codex child threads can be opened as read-only transcripts.
        screen = ChatScreen.codex(
          cxThread: CodexThread(
            id: sessionId,
            preview: title,
            cwd: cwd,
            createdAt: DateTime.now().millisecondsSinceEpoch,
            updatedAt: DateTime.now().millisecondsSinceEpoch,
            agentNickname: agentType,
          ),
        );
      case AgentType.pi:
        // Pi subagents from compact agent card are tool invocations (Task,
        // oracle, finder, etc.). They don't have their own session file.
        // Open as read-only Pi session — the hydrator will use the session
        // path to read messages from JSONL.
        screen = ChatScreen.pi(
          piSession: PiSessionInfo(
            path: sessionId, // Pi hydrator checks hasSessionPath
            id: sessionId,
            cwd: cwd,
            created: DateTime.now(),
            modified: DateTime.now(),
            messageCount: 0,
            firstMessage: title,
          ),
          readOnly: true,
        );
    }

    Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
  }
}
