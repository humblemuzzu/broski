import 'package:broski/models/vcs.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/format_utils.dart';
import 'package:broski/widgets/chat/action_row.dart';
import 'package:broski/widgets/chat/action_tile.dart';
import 'package:broski/widgets/chat/agent_status_bar.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:flutter/material.dart';

/// OpenCode session actions content. Extracted from chat_screen.dart.
class SessionActionsContent extends StatelessWidget {
  const SessionActionsContent({
    super.key,
    required this.theme,
    required this.vcsInfo,
    required this.isConnected,
    required this.rttMs,
    required this.currentModel,
    required this.onModelTap,
    required this.isSessionShared,
    required this.isCompacting,
    required this.isStreaming,
    required this.onAction,
    this.onOpenSidebar,
  });
  final OpenCodeTheme theme;
  final VcsInfo? vcsInfo;
  final bool isConnected;
  final int? rttMs;
  final SelectedModel? currentModel;
  final VoidCallback? onModelTap;
  final bool isSessionShared;
  final bool isCompacting;
  final bool isStreaming;
  final void Function(String) onAction;
  final VoidCallback? onOpenSidebar;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Status bar (branch, latency, model)
        AgentStatusBar(
          theme: theme,
          isConnected: isConnected,
          rttMs: rttMs,
          modelName: getModelDisplayName(
            currentModel?.modelID,
            fallback: 'Auto',
            maxLength: 8,
          ),
          modelColor: theme.primary,
          onModelTap: () {
            Navigator.pop(context);
            onModelTap?.call();
          },
          leading: (vcsInfo != null && vcsInfo!.isAvailable)
              ? Padding(
                  padding: const EdgeInsets.only(right: Spacing.sm),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: theme.success.withValues(alpha: 0.1),
                      borderRadius: Radii.brSm,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          AppIcons.callSplit,
                          size: 14,
                          color: theme.success,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          vcsInfo!.branch ?? 'main',
                          style: TextStyle(
                            fontSize: 12,
                            color: theme.success,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        if (vcsInfo!.isOnFeatureBranch) ...[
                          const SizedBox(width: 4),
                          Text(
                            '← ${vcsInfo!.defaultBranch}',
                            style: TextStyle(
                              fontSize: 11,
                              color: theme.success.withValues(alpha: 0.6),
                              fontWeight: FontWeight.w400,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                )
              : null,
        ),
        // Session actions
        Padding(
          padding: Insets.screenAll,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Project tools (Option 3 entrypoint)
              SectionHeader(title: 'PROJECT', theme: theme),
              const SizedBox(height: Spacing.md),
              ActionRow(
                icon: AppIcons.gridView,
                label: 'Project Tools',
                subtitle: 'Skills, commands, agents, MCP, plugins',
                theme: theme,
                color: theme.accent,
                onTap: () => onAction('project_tools'),
              ),
              const SizedBox(height: Spacing.xl),
              // Session section
              SectionHeader(title: 'SESSION', theme: theme),
              const SizedBox(height: Spacing.md),
              Row(
                children: [
                  ActionTile(
                    icon: AppIcons.info,
                    label: 'Info',
                    theme: theme,
                    onTap: () {
                      Navigator.pop(context);
                      // Delay to allow bottom sheet to close first
                      Future.delayed(
                        const Duration(milliseconds: 150),
                        () => onOpenSidebar?.call(),
                      );
                    },
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.add,
                    label: 'New',
                    theme: theme,
                    onTap: () => onAction('new_session'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.callSplit,
                    label: 'Fork',
                    theme: theme,
                    onTap: () => onAction('fork'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: isSessionShared ? AppIcons.unlink : AppIcons.share,
                    label: isSessionShared ? 'Unshare' : 'Share',
                    theme: theme,
                    onTap: () =>
                        onAction(isSessionShared ? 'unshare' : 'share'),
                  ),
                ],
              ),
              const SizedBox(height: Spacing.xl),
              // Tools section
              SectionHeader(title: 'TOOLS', theme: theme),
              const SizedBox(height: Spacing.md),
              ActionRow(
                icon: AppIcons.compress,
                label: isCompacting ? 'Compacting...' : 'Compact',
                subtitle: 'Summarize context to free space',
                theme: theme,
                enabled: !isCompacting,
                onTap: () => onAction('compact'),
              ),
              const SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.autoFix,
                label: 'Initialize Project',
                subtitle: 'Create AGENTS.md for this project',
                theme: theme,
                color: theme.success,
                onTap: () => onAction('init'),
              ),
              const SizedBox(height: Spacing.xl),
              // Danger zone
              SectionHeader(
                title: 'DANGER ZONE',
                theme: theme,
                color: theme.error.withValues(alpha: 0.7),
              ),
              const SizedBox(height: Spacing.md),
              if (isStreaming) ...[
                ActionRow(
                  icon: AppIcons.stop,
                  label: 'Stop Agent',
                  subtitle: 'Abort the current AI response',
                  theme: theme,
                  color: theme.error,
                  onTap: () => onAction('stop'),
                ),
                const SizedBox(height: Spacing.sm),
              ],
              ActionRow(
                icon: AppIcons.undo,
                label: 'Undo Last Changes',
                subtitle: 'Revert recent file modifications',
                theme: theme,
                color: theme.warning,
                onTap: () => onAction('undo'),
              ),
              const SizedBox(height: Spacing.sm),
              ActionRow(
                icon: AppIcons.cleaning,
                label: 'Clear Instance',
                subtitle: 'Reset project context completely',
                theme: theme,
                color: theme.warning,
                onTap: () => onAction('clear_instance'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
