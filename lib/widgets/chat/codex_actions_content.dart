import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/format_utils.dart';
import 'package:broski/widgets/chat/action_row.dart';
import 'package:broski/widgets/chat/action_tile.dart';
import 'package:broski/widgets/chat/agent_status_bar.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:flutter/material.dart';

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
              const SizedBox(height: Spacing.xl),
              // Configuration section
              SectionHeader(title: 'CONFIGURATION', theme: theme),
              const SizedBox(height: Spacing.md),
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
              const SizedBox(height: Spacing.xl),
              // Project section
              SectionHeader(title: 'PROJECT', theme: theme),
              const SizedBox(height: Spacing.md),
              ActionRow(
                icon: AppIcons.description,
                label: 'AGENTS.md',
                subtitle: 'Edit project agent instructions',
                theme: theme,
                onTap: () => onAction('cx_agents'),
              ),
              const SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.toc,
                label: 'Config',
                subtitle: 'View and edit Codex configuration',
                theme: theme,
                onTap: () => onAction('cx_config'),
              ),
              const SizedBox(height: Spacing.xl),
              // Actions section
              SectionHeader(title: 'ACTIONS', theme: theme),
              const SizedBox(height: Spacing.md),
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
              const SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.diff,
                label: 'View Changes',
                subtitle: 'See files changed by AI and revert',
                theme: theme,
                color: theme.warning,
                onTap: () => onAction('cx_changeset'),
              ),
              const SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.compress,
                label: 'Compact',
                subtitle: 'Summarize old messages to free context',
                theme: theme,
                onTap: () => onAction('cx_compact'),
              ),
              const SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.speed,
                label: 'Rate Limits',
                subtitle: 'View usage limits and resets',
                theme: theme,
                onTap: () => onAction('cx_rate_limits'),
              ),
              const SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.openExternal,
                label: 'Open in Desktop',
                subtitle: 'Continue this thread in Codex desktop app',
                theme: theme,
                onTap: () => onAction('cx_desktop_handoff'),
              ),
              const SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.feedback,
                label: 'Feedback',
                subtitle: 'Send feedback to Codex team',
                theme: theme,
                onTap: () => onAction('cx_feedback'),
              ),
              if (isStreaming) ...[
                const SizedBox(height: Spacing.xl),
                SectionHeader(
                  title: 'DANGER ZONE',
                  theme: theme,
                  color: theme.error.withValues(alpha: 0.7),
                ),
                const SizedBox(height: Spacing.md),
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
