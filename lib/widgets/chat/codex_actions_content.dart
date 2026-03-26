import 'package:flutter/material.dart';

import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'action_row.dart';
import 'action_tile.dart';

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
  String _getModelName(String? model) {
    if (model == null || model.isEmpty) return 'Default';
    final m = model.toLowerCase();
    if (m.contains('o1')) return 'o1';
    if (m.contains('o3')) return 'o3';
    if (m.contains('gpt-4')) return 'GPT-4';
    return model.length > 12 ? '${model.substring(0, 12)}...' : model;
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Status bar (latency, model)
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 16),
          child: Row(
            children: [
              // Latency
              if (isConnected && rttMs != null) ...[
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: theme.info.withValues(alpha: 0.1),
                    borderRadius: Radii.brSm,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(AppIcons.speed, size: 14, color: theme.info),
                      const SizedBox(width: 6),
                      Text(
                        '${rttMs}ms',
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.info,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const Spacer(),
              // Model selector (onAction handles Navigator.pop)
              GestureDetector(
                onTap: () => onAction('cx_model'),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: theme.primary.withValues(alpha: 0.1),
                    borderRadius: Radii.brSm,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        AppIcons.autoAwesome,
                        size: 14,
                        color: theme.primary,
                      ),
                      const SizedBox(width: 6),
                      Text(
                        _getModelName(codexModel),
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.primary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      SizedBox(width: Spacing.xs),
                      Icon(
                        AppIcons.chevronRight,
                        size: 16,
                        color: theme.primary,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
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
              Text(
                'CONFIGURATION',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: theme.textMuted,
                  letterSpacing: 0.5,
                ),
              ),
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
              Text(
                'PROJECT',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: theme.textMuted,
                  letterSpacing: 0.5,
                ),
              ),
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
              Text(
                'ACTIONS',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: theme.textMuted,
                  letterSpacing: 0.5,
                ),
              ),
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
                Text(
                  'DANGER ZONE',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: theme.error.withValues(alpha: 0.7),
                    letterSpacing: 0.5,
                  ),
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
