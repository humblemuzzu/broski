import 'package:flutter/material.dart';

import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'action_row.dart';
import 'action_tile.dart';

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
  String _getModelName(String? model) {
    if (model == null || model.isEmpty) return 'Claude';
    final m = model.toLowerCase();
    if (m.contains('opus')) return 'Opus';
    if (m.contains('sonnet')) return 'Sonnet';
    if (m.contains('haiku')) return 'Haiku';
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
                onTap: () => onAction('cc_model'),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 6,
                  ),
                  decoration: BoxDecoration(
                    color: theme.accent.withValues(alpha: 0.1),
                    borderRadius: Radii.brSm,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(AppIcons.autoAwesome, size: 14, color: theme.accent),
                      const SizedBox(width: 6),
                      Text(
                        _getModelName(ccModel),
                        style: TextStyle(
                          fontSize: 12,
                          color: theme.accent,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      SizedBox(width: Spacing.xs),
                      Icon(
                        AppIcons.chevronRight,
                        size: 16,
                        color: theme.accent,
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
              Text(
                'INTEGRATION',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: theme.textMuted,
                  letterSpacing: 0.5,
                ),
              ),
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
              Text(
                'SESSION',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: theme.textMuted,
                  letterSpacing: 0.5,
                ),
              ),
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
