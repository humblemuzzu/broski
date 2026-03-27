import 'package:broski/utils/format_utils.dart';
import 'package:flutter/material.dart';

import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'action_row.dart';
import 'action_tile.dart';
import 'agent_status_bar.dart';
import 'section_header.dart';

/// Claude Code actions content. Extracted from chat_screen.dart.
class ClaudeCodeActionsContent extends StatelessWidget {
  const ClaudeCodeActionsContent({
    super.key,
    required this.theme,
    required this.isConnected,
    required this.rttMs,
    required this.ccModel,
    required this.isStreaming,
    required this.onAction,
  });
  final OpenCodeTheme theme;
  final bool isConnected;
  final int? rttMs;
  final String? ccModel;
  final bool isStreaming;
  final void Function(String) onAction;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Status bar (latency, model)
        AgentStatusBar(
          theme: theme,
          isConnected: isConnected,
          rttMs: rttMs,
          modelName: getModelDisplayName(ccModel, fallback: 'Claude'),
          modelColor: theme.accent,
          onModelTap: () => onAction('cc_model'),
        ),
        // Actions
        Padding(
          padding: Insets.screenAll,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Configuration section
              SectionHeader(title: 'CONFIGURATION', theme: theme),
              SizedBox(height: Spacing.md),
              ActionRow(
                icon: AppIcons.gridView,
                label: 'Project Tools',
                subtitle: 'Manage skills, commands, hooks, MCP, plugins',
                theme: theme,
                color: theme.accent,
                onTap: () => onAction('project_tools'),
              ),
              SizedBox(height: Spacing.md),
              Row(
                children: [
                  ActionTile(
                    icon: AppIcons.tune,
                    label: 'Tools',
                    theme: theme,
                    onTap: () => onAction('cc_tools'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.bolt,
                    label: 'Commands',
                    theme: theme,
                    onTap: () => onAction('cc_commands'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.autoAwesome,
                    label: 'Skills',
                    theme: theme,
                    onTap: () => onAction('cc_skills'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.link,
                    label: 'Hooks',
                    theme: theme,
                    onTap: () => onAction('cc_hooks'),
                  ),
                ],
              ),
              SizedBox(height: Spacing.xl),
              // Integration section
              SectionHeader(title: 'INTEGRATION', theme: theme),
              SizedBox(height: Spacing.md),
              ActionRow(
                icon: AppIcons.hub,
                label: 'MCP Servers',
                subtitle: 'Configure Model Context Protocol servers',
                theme: theme,
                onTap: () => onAction('cc_mcp'),
              ),
              SizedBox(height: Spacing.xl),
              // Session section
              SectionHeader(title: 'SESSION', theme: theme),
              SizedBox(height: Spacing.md),
              ActionRow(
                icon: AppIcons.callSplit,
                label: 'Fork Session',
                subtitle: 'Create a new branch from current conversation',
                theme: theme,
                onTap: () => onAction('cc_fork'),
              ),
              if (isStreaming) ...[
                SizedBox(height: Spacing.xl),
                SectionHeader(
                  title: 'DANGER ZONE',
                  theme: theme,
                  color: theme.error.withValues(alpha: 0.7),
                ),
                SizedBox(height: Spacing.md),
                ActionRow(
                  icon: AppIcons.stop,
                  label: 'Stop Agent',
                  subtitle: 'Abort the current AI response',
                  theme: theme,
                  color: theme.error,
                  onTap: () => onAction('stop'),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
