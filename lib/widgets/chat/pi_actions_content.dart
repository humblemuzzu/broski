import 'package:broski/utils/format_utils.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/pi.dart';
import '../../providers/chat_provider.dart';
import '../../providers/pi_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'action_row.dart';
import 'action_tile.dart';
import 'agent_status_bar.dart';
import 'section_header.dart';

/// Pi actions content. Extracted from chat_screen.dart.
class PiActionsContent extends ConsumerWidget {
  const PiActionsContent({
    super.key,
    required this.theme,
    required this.isConnected,
    required this.rttMs,
    required this.piModel,
    required this.isStreaming,
    required this.onAction,
  });
  final OpenCodeTheme theme;
  final bool isConnected;
  final int? rttMs;
  final String? piModel;
  final bool isStreaming;
  final void Function(String) onAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chatState = ref.watch(chatSessionProvider);
    final thinkingLevel = chatState.piThinkingLevel ?? PiThinkingLevel.medium;
    final cwd = chatState.piCwd;
    final statsAsync = ref.watch(piSessionStatsProvider(cwd));

    // Use Column — DetailSheet's SingleChildScrollView handles scrolling
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        // Status bar (latency, model)
        AgentStatusBar(
          theme: theme,
          isConnected: isConnected,
          rttMs: rttMs,
          modelName: getModelDisplayName(piModel, fallback: 'Default'),
          modelColor: theme.primary,
          onModelTap: () => onAction('pi_model'),
          bottomPadding: 12,
        ),
        // Context & Cost summary
        statsAsync.when(
          data: (stats) {
            // Use Pi's actual context estimation (from estimateContextTokens)
            // not cumulative cache tokens which can be millions
            final ctxUsage = stats.contextUsage;
            final contextWindow =
                ctxUsage?.contextWindow ??
                chatState.piModelData?.contextWindow ??
                kDefaultContextWindow;
            final contextTokens = ctxUsage?.tokens ?? stats.tokens.input;
            final contextPct =
                ctxUsage?.percent ??
                (contextWindow > 0
                    ? (contextTokens / contextWindow * 100).clamp(0.0, 100.0)
                    : 0.0);
            final costStr = stats.cost > 0
                ? '\$${stats.cost.toStringAsFixed(4)}'
                : 'Free';
            return Padding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: theme.backgroundPanel,
                  borderRadius: Radii.brMd,
                  border: Border.all(color: theme.borderSubtle),
                ),
                child: Column(
                  children: [
                    // Context bar — actual window usage
                    Row(
                      children: [
                        Icon(AppIcons.memory, size: 13, color: theme.info),
                        const SizedBox(width: 6),
                        Text(
                          '${formatTokens(contextTokens)} / ${formatTokens(contextWindow)}',
                          style: AppTypography.caption(color: theme.textMuted),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          '${contextPct.toStringAsFixed(1)}%',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                            color: contextPct > 80
                                ? theme.error
                                : contextPct > 50
                                ? theme.warning
                                : theme.info,
                          ),
                        ),
                        const Spacer(),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: theme.success.withValues(alpha: 0.1),
                            borderRadius: Radii.brSm,
                          ),
                          child: Text(
                            costStr,
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              color: theme.success,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    ClipRRect(
                      borderRadius: Radii.brXs,
                      child: LinearProgressIndicator(
                        value: (contextPct / 100).clamp(0.0, 1.0),
                        minHeight: 4,
                        color: contextPct > 80
                            ? theme.error
                            : contextPct > 50
                            ? theme.warning
                            : theme.info,
                        backgroundColor: theme.backgroundElement,
                      ),
                    ),
                    const SizedBox(height: 6),
                    // Token breakdown — In/Out on first line, Cache on second
                    Row(
                      children: [
                        Text(
                          'In ${formatTokens(stats.tokens.input)}',
                          style: AppTypography.caption(color: theme.textMuted),
                        ),
                        Text(
                          '  Out ${formatTokens(stats.tokens.output)}',
                          style: AppTypography.caption(color: theme.textMuted),
                        ),
                        const Spacer(),
                        Text(
                          '${stats.totalMessages} msgs',
                          style: AppTypography.caption(color: theme.textMuted),
                        ),
                      ],
                    ),
                    // Cache tokens shown separately (cumulative, not context)
                    if (stats.tokens.cacheRead > 0 ||
                        stats.tokens.cacheWrite > 0) ...[
                      const SizedBox(height: 3),
                      Row(
                        children: [
                          if (stats.tokens.cacheRead > 0)
                            Text(
                              'R ${formatTokens(stats.tokens.cacheRead)}',
                              style: AppTypography.caption(
                                color: theme.info.withValues(alpha: 0.7),
                              ),
                            ),
                          if (stats.tokens.cacheRead > 0 &&
                              stats.tokens.cacheWrite > 0)
                            Text(
                              '  ',
                              style: AppTypography.caption(
                                color: theme.textMuted,
                              ),
                            ),
                          if (stats.tokens.cacheWrite > 0)
                            Text(
                              'W ${formatTokens(stats.tokens.cacheWrite)}',
                              style: AppTypography.caption(
                                color: theme.warning.withValues(alpha: 0.7),
                              ),
                            ),
                          const Spacer(),
                          Text(
                            'cache (cumulative)',
                            style: TextStyle(
                              fontSize: 9,
                              color: theme.textMuted.withValues(alpha: 0.5),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            );
          },
          loading: () => const SizedBox.shrink(),
          error: (_, __) => const SizedBox.shrink(),
        ),
        // Actions
        Padding(
          padding: Insets.screenAll,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Thinking Level
              SectionHeader(title: 'THINKING LEVEL', theme: theme),
              SizedBox(height: Spacing.md),
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: PiThinkingLevel.values.map((level) {
                    final isSelected = level == thinkingLevel;
                    return Padding(
                      padding: const EdgeInsets.only(right: 8),
                      child: GestureDetector(
                        onTap: () {
                          Navigator.pop(context);
                          final piBridge = ref.read(piBridgeServiceProvider);
                          final cwd = chatState.piCwd;
                          piBridge
                              .setThinkingLevel(level: level, projectPath: cwd)
                              .then(
                                (_) => ref
                                    .read(chatSessionProvider.notifier)
                                    .setPiThinkingLevel(level),
                              );
                        },
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? theme.primary.withValues(alpha: 0.15)
                                : theme.backgroundPanel,
                            borderRadius: Radii.brXl,
                            border: Border.all(
                              color: isSelected
                                  ? theme.primary
                                  : theme.borderSubtle,
                              width: isSelected ? 1.5 : 1,
                            ),
                          ),
                          child: Text(
                            level.displayName,
                            style: TextStyle(
                              color: isSelected ? theme.primary : theme.text,
                              fontSize: 13,
                              fontWeight: isSelected
                                  ? FontWeight.w600
                                  : FontWeight.w500,
                            ),
                          ),
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
              SizedBox(height: Spacing.xl),
              // Quick Actions
              SectionHeader(title: 'ACTIONS', theme: theme),
              SizedBox(height: Spacing.md),
              Row(
                children: [
                  ActionTile(
                    icon: AppIcons.autoAwesome,
                    label: 'Model',
                    theme: theme,
                    onTap: () => onAction('pi_model'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.bolt,
                    label: 'Skills',
                    theme: theme,
                    onTap: () => onAction('pi_skills'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.callSplit,
                    label: 'Sidebar',
                    theme: theme,
                    onTap: () => onAction('pi_sidebar'),
                  ),
                ],
              ),
              SizedBox(height: Spacing.md),
              Row(
                children: [
                  ActionTile(
                    icon: AppIcons.compress,
                    label: 'Compact',
                    theme: theme,
                    onTap: () => onAction('pi_compact'),
                  ),
                  const SizedBox(width: 10),
                  ActionTile(
                    icon: AppIcons.add,
                    label: 'New Chat',
                    theme: theme,
                    onTap: () => onAction('pi_new_session'),
                  ),
                  const SizedBox(width: 10),
                  // Spacer tile
                  const Expanded(child: SizedBox()),
                ],
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
        // Bottom padding for safe area
        SizedBox(height: MediaQuery.of(context).padding.bottom + 16),
      ],
    );
  }
}
