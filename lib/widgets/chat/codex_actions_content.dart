import 'package:broski/utils/format_utils.dart';
import 'package:flutter/material.dart';

import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'action_row.dart';
import 'action_tile.dart';
import 'agent_status_bar.dart';
import 'section_header.dart';

/// Codex actions content. Extracted from chat_screen.dart.
class CodexActionsContent extends StatelessWidget {
  const CodexActionsContent({
    super.key,
    required this.theme,
    required this.isConnected,
    required this.rttMs,
    required this.codexModel,
    required this.isStreaming,
    required this.onAction,
  });
  final OpenCodeTheme theme;
  final bool isConnected;
  final int? rttMs;
  final String? codexModel;
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
          modelName: getModelDisplayName(codexModel, fallback: 'Default'),
          modelColor: theme.primary,
          onModelTap: () => onAction('cx_model'),
        ),
        // Actions
        Padding(
          padding: Insets.screenAll,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ActionRow(
                icon: AppIcons.gridView,
                label: 'Project Tools',
                subtitle: 'Skills, agents, MCP, config',
                theme: theme,
                color: theme.accent,
                onTap: () => onAction('project_tools'),
              ),
              SizedBox(height: Spacing.xl),
              // Configuration section
              SectionHeader(title: 'CONFIGURATION', theme: theme),
              SizedBox(height: Spacing.md),
              Row(
                children: [
                  ActionTile(
                    icon: AppIcons.tune,
                    label: 'Settings',
                    theme: theme,
                    onTap: () => onAction('cx_settings'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.autoAwesome,
                    label: 'Skills',
                    theme: theme,
                    onTap: () => onAction('cx_skills'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.hub,
                    label: 'MCP',
                    theme: theme,
                    onTap: () => onAction('cx_mcp'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.shieldCheck,
                    label: 'Auth',
                    theme: theme,
                    onTap: () => onAction('cx_auth'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.extension_,
                    label: 'Apps',
                    theme: theme,
                    onTap: () => onAction('cx_apps'),
                  ),
                ],
              ),
              SizedBox(height: Spacing.xl),
              // Project section
              SectionHeader(title: 'PROJECT', theme: theme),
              SizedBox(height: Spacing.md),
              ActionRow(
                icon: AppIcons.description,
                label: 'AGENTS.md',
                subtitle: 'Edit project agent instructions',
                theme: theme,
                onTap: () => onAction('cx_agents'),
              ),
              SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.toc,
                label: 'Config',
                subtitle: 'View and edit Codex configuration',
                theme: theme,
                onTap: () => onAction('cx_config'),
              ),
              SizedBox(height: Spacing.xl),
              // Actions section
              SectionHeader(title: 'ACTIONS', theme: theme),
              SizedBox(height: Spacing.md),
              Row(
                children: [
                  Expanded(
                    child: ActionRow(
                      icon: AppIcons.rateReview,
                      label: 'Review',
                      subtitle: 'Review pending changes',
                      theme: theme,
                      onTap: () => onAction('cx_review'),
                    ),
                  ),
                ],
              ),
              SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.feedback,
                label: 'Feedback',
                subtitle: 'Send feedback to Codex team',
                theme: theme,
                onTap: () => onAction('cx_feedback'),
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
