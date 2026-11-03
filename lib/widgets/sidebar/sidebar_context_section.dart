import 'package:broski/models/session_context.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sidebar/sidebar_section.dart';
import 'package:broski/widgets/sidebar/sidebar_stat_item.dart';
import 'package:broski/widgets/sidebar/sidebar_token_row.dart';
import 'package:flutter/material.dart';

/// How much of the context window the session has used: the bar, the figures
/// beside it and the breakdown of the tokens spent.
class ContextUsageSection extends StatelessWidget {
  const ContextUsageSection({super.key, required this.sessionContext});

  final SessionContext sessionContext;

  @override
  Widget build(BuildContext context) {
    final tokens = sessionContext.tokens;
    final usagePercent = sessionContext.contextUsagePercent;
    final remainingTokens = tokens.contextWindow - tokens.contextTokens;
    return SidebarSection(
      title: 'Context',
      trailing: _ContextTotal(tokens: tokens),
      children: [
        _UsageBar(percent: usagePercent),
        const SizedBox(height: Spacing.md),
        _ContextStats(
          sessionContext: sessionContext,
          usagePercent: usagePercent,
          remainingTokens: remainingTokens,
        ),
        if (tokens.input > 0 || tokens.output > 0) ...[
          const SizedBox(height: 10),
          _TokenBreakdown(tokens: tokens),
        ],
      ],
    );
  }
}

class _ContextTotal extends StatelessWidget {
  const _ContextTotal({required this.tokens});

  final TokenUsage tokens;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Text(
      tokens.contextTokens > 0
          ? '${tokens.formatCount(tokens.contextTokens)} / ${tokens.formatCount(tokens.contextWindow)}'
          : '${tokens.formatCount(tokens.total)} tokens',
      style: TextStyle(
        fontSize: 12,
        color: theme.textMuted,
        fontWeight: FontWeight.w500,
      ),
    );
  }
}

class _UsageBar extends StatelessWidget {
  const _UsageBar({required this.percent});

  final double percent;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      height: 6,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brXs,
      ),
      child: LayoutBuilder(
        builder: (context, constraints) => Stack(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              width: constraints.maxWidth * (percent / 100).clamp(0.0, 1.0),
              decoration: BoxDecoration(
                color: percent > 80
                    ? theme.error
                    : percent > 50
                    ? theme.warning
                    : theme.info,
                borderRadius: Radii.brXs,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ContextStats extends StatelessWidget {
  const _ContextStats({
    required this.sessionContext,
    required this.usagePercent,
    required this.remainingTokens,
  });

  final SessionContext sessionContext;
  final double usagePercent;
  final int remainingTokens;

  @override
  Widget build(BuildContext context) {
    final tokens = sessionContext.tokens;
    return Wrap(
      spacing: 10,
      runSpacing: 8,
      children: [
        SidebarStatItem(
          icon: AppIcons.memory,
          label: '${usagePercent.toStringAsFixed(0)}% used',
        ),
        if (remainingTokens > 0)
          SidebarStatItem(
            icon: AppIcons.dataUsage,
            label: tokens.formatCount(
              remainingTokens.clamp(0, tokens.contextWindow),
            ),
            sublabel: 'remaining',
          ),
        SidebarStatItem(
          icon: AppIcons.wallet,
          label: sessionContext.formattedCost,
          sublabel: 'spent',
        ),
        if (sessionContext.budgetRemainingUsd != null)
          SidebarStatItem(
            icon: AppIcons.wallet,
            label: sessionContext.formattedBudgetRemaining,
            sublabel: 'budget left',
          ),
      ],
    );
  }
}

class _TokenBreakdown extends StatelessWidget {
  const _TokenBreakdown({required this.tokens});

  final TokenUsage tokens;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      padding: Insets.cardXs,
      decoration: BoxDecoration(
        color: theme.background,
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.borderSubtle.withValues(alpha: 0.2)),
      ),
      child: Column(
        children: [
          _row('Input', tokens.input, theme.info),
          _row('Output', tokens.output, theme.accent),
          if ((tokens.cacheRead ?? 0) > 0)
            _row('Cache Read', tokens.cacheRead!, theme.success),
          if ((tokens.cacheWrite ?? 0) > 0)
            _row('Cache Write', tokens.cacheWrite!, theme.warning),
          if ((tokens.reasoning ?? 0) > 0)
            _row('Reasoning', tokens.reasoning!, theme.textMuted),
        ],
      ),
    );
  }

  Widget _row(String label, int count, Color color) => SidebarTokenRow(
    label: label,
    value: tokens.formatCount(count),
    color: color,
  );
}
