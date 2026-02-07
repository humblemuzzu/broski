import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../models/subscription_usage.dart';
import '../providers/service_providers.dart';
import '../providers/subscription_usage_provider.dart';
import '../theme/opencode_theme.dart';

/// Screen for displaying AI provider usage limits and credits.
///
/// Shows the user's own AI usage (Claude, OpenAI) -- not Broski usage.
/// Mobile-optimized layout with text above progress bars.
class SubscriptionUsageScreen extends ConsumerStatefulWidget {
  const SubscriptionUsageScreen({super.key});

  @override
  ConsumerState<SubscriptionUsageScreen> createState() =>
      _SubscriptionUsageScreenState();
}

class _SubscriptionUsageScreenState
    extends ConsumerState<SubscriptionUsageScreen> {
  ClaudeCodeAccountInfo? _claudeAccountInfo;
  bool _isRefreshingAccountInfo = false;

  @override
  void initState() {
    super.initState();
    // Fetch on screen open
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _refreshAll();
    });
  }

  Future<void> _refreshAll() async {
    await Future.wait([
      ref.read(subscriptionUsageProvider.notifier).refresh(),
      _refreshClaudeAccountInfo(),
    ]);
  }

  Future<void> _refreshClaudeAccountInfo() async {
    if (_isRefreshingAccountInfo) return;

    setState(() {
      _isRefreshingAccountInfo = true;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final accountInfo = await bridge.ccGetAccountInfo();
      if (!mounted) return;

      final hasData =
          (accountInfo.email ?? '').trim().isNotEmpty ||
          (accountInfo.organization ?? '').trim().isNotEmpty ||
          (accountInfo.subscriptionType ?? '').trim().isNotEmpty ||
          (accountInfo.apiKeySource ?? '').trim().isNotEmpty;

      setState(() {
        _claudeAccountInfo = hasData ? accountInfo : null;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _claudeAccountInfo = null;
      });
    } finally {
      if (mounted) {
        setState(() {
          _isRefreshingAccountInfo = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(subscriptionUsageProvider);
    final ocTheme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: Text(
          'AI Usage',
          style: TextStyle(
            color: ocTheme.text,
            fontSize: 18,
            fontWeight: FontWeight.w600,
          ),
        ),
        leading: IconButton(
          icon: Icon(Icons.arrow_back_rounded, color: ocTheme.text),
          onPressed: () => Navigator.pop(context),
        ),
        actions: [
          if (state.isLoading || _isRefreshingAccountInfo)
            Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: ocTheme.primary,
                ),
              ),
            )
          else
            IconButton(
              icon: Icon(Icons.refresh_rounded, color: ocTheme.text),
              onPressed: _refreshAll,
              tooltip: 'Refresh',
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshAll,
        color: ocTheme.primary,
        child: _buildBody(context, state),
      ),
    );
  }

  Widget _buildBody(BuildContext context, SubscriptionUsageState state) {
    final ocTheme = OpenCodeTheme.of(context);

    if (state.isLoading && state.usage == null) {
      return _buildLoadingSkeleton(context);
    }

    if (state.error != null && state.usage == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.error_outline_rounded, size: 48, color: ocTheme.error),
              const SizedBox(height: 16),
              Text(
                'Failed to load usage',
                style: TextStyle(
                  color: ocTheme.text,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                state.error!,
                style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              ElevatedButton.icon(
                onPressed: _refreshAll,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('Try Again'),
              ),
            ],
          ),
        ),
      );
    }

    final usage = state.usage;
    if (usage == null || usage.providers.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.data_usage_rounded,
                size: 64,
                color: ocTheme.primary.withValues(alpha: 0.5),
              ),
              const SizedBox(height: 16),
              Text(
                'No providers configured',
                style: TextStyle(
                  color: ocTheme.text,
                  fontSize: 18,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Run `claude login` or `codex` on your Mac to configure providers.',
                style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      children: [
        if (_claudeAccountInfo != null) ...[
          _ClaudeAccountCard(accountInfo: _claudeAccountInfo!),
          const SizedBox(height: 12),
        ],
        // Last updated
        Padding(
          padding: const EdgeInsets.only(bottom: 16),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(
                Icons.access_time_rounded,
                size: 12,
                color: ocTheme.textMuted.withValues(alpha: 0.6),
              ),
              const SizedBox(width: 4),
              Text(
                'Last updated: ${usage.fetchedAgoString}',
                style: TextStyle(
                  color: ocTheme.textMuted.withValues(alpha: 0.6),
                  fontSize: 11,
                ),
              ),
            ],
          ),
        ),

        // Provider cards
        for (final provider in usage.providers) ...[
          _ProviderCard(provider: provider),
          const SizedBox(height: 16),
        ],

        // Bottom padding
        const SizedBox(height: 40),
      ],
    );
  }

  Widget _buildLoadingSkeleton(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      children: [
        _SkeletonProviderCard(),
        const SizedBox(height: 16),
        _SkeletonProviderCard(),
      ],
    );
  }
}

class _ClaudeAccountCard extends StatelessWidget {
  const _ClaudeAccountCard({required this.accountInfo});

  final ClaudeCodeAccountInfo accountInfo;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final details = <String>[
      if ((accountInfo.organization ?? '').trim().isNotEmpty)
        'Org: ${accountInfo.organization}',
      if ((accountInfo.subscriptionType ?? '').trim().isNotEmpty)
        'Plan: ${accountInfo.subscriptionType}',
      if ((accountInfo.apiKeySource ?? '').trim().isNotEmpty)
        'Key source: ${accountInfo.apiKeySource}',
    ];

    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 38,
            height: 38,
            decoration: BoxDecoration(
              color: ocTheme.primary.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Icon(
              Icons.verified_user_rounded,
              color: ocTheme.primary,
              size: 20,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Claude Account',
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  (accountInfo.email ?? '').trim().isNotEmpty
                      ? accountInfo.email!
                      : 'Authenticated account',
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (details.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Text(
                    details.join(' • '),
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Provider usage card with all details.
class _ProviderCard extends StatelessWidget {
  const _ProviderCard({required this.provider});

  final ProviderUsage provider;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    // Use theme colors instead of hardcoded provider colors
    // Claude uses primary (blue), OpenAI uses info (cyan/teal)
    final providerColor = provider.providerId == 'claude'
        ? ocTheme.primary
        : ocTheme.info;

    return Container(
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                // Provider icon
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: providerColor.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    provider.providerId == 'claude'
                        ? Icons.auto_awesome_rounded
                        : Icons.psychology_rounded,
                    color: providerColor,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 12),
                // Provider name and plan
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        provider.providerName,
                        style: TextStyle(
                          color: ocTheme.text,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      if (provider.plan != null) ...[
                        const SizedBox(height: 4),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: providerColor.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            provider.plan!,
                            style: TextStyle(
                              color: providerColor,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                // Source badge
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: ocTheme.backgroundElement,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    provider.source.toUpperCase(),
                    style: TextStyle(
                      color: ocTheme.textMuted,
                      fontSize: 9,
                      fontWeight: FontWeight.w600,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Error state
          if (provider.error != null) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: ocTheme.error.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.error_outline_rounded,
                      size: 18,
                      color: ocTheme.error,
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        provider.error!,
                        style: TextStyle(color: ocTheme.error, fontSize: 13),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],

          // Usage windows
          if (provider.hasUsageData) ...[
            // Plan usage limits section
            if (provider.sessionWindow != null) ...[
              _SectionHeader(title: 'Session Usage'),
              _UsageBarVertical(
                label: 'Current Session',
                subtitle: provider.sessionWindow!.resetTimeString.isNotEmpty
                    ? 'Resets in ${provider.sessionWindow!.resetTimeString}'
                    : null,
                usedPercent: provider.sessionWindow!.usedPercent,
                color: providerColor,
              ),
            ],

            // Weekly limits section
            if (provider.weeklyWindow != null ||
                provider.weeklyOpusWindow != null ||
                provider.weeklySonnetWindow != null) ...[
              _SectionHeader(title: 'Weekly Usage'),
              if (provider.weeklyWindow != null)
                _UsageBarVertical(
                  label: 'All Models',
                  subtitle: provider.weeklyWindow!.resetDateString,
                  usedPercent: provider.weeklyWindow!.usedPercent,
                  color: providerColor,
                ),
              if (provider.weeklySonnetWindow != null)
                _UsageBarVertical(
                  label: 'Sonnet',
                  subtitle: provider.weeklySonnetWindow!.resetDateString,
                  usedPercent: provider.weeklySonnetWindow!.usedPercent,
                  color: ocTheme.secondary,
                ),
              if (provider.weeklyOpusWindow != null)
                _UsageBarVertical(
                  label: 'Opus',
                  subtitle: provider.weeklyOpusWindow!.resetDateString,
                  usedPercent: provider.weeklyOpusWindow!.usedPercent,
                  color: ocTheme.accent,
                ),
            ],

            // Extra usage section (Claude)
            if (provider.extraUsage != null) ...[
              _SectionHeader(title: 'Extra Usage'),

              // Toggle row
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Continue using Claude after hitting your limit',
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 5,
                      ),
                      decoration: BoxDecoration(
                        color: provider.extraUsage!.isEnabled
                            ? ocTheme.success.withValues(alpha: 0.15)
                            : ocTheme.backgroundElement,
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Text(
                        provider.extraUsage!.isEnabled ? 'ON' : 'OFF',
                        style: TextStyle(
                          color: provider.extraUsage!.isEnabled
                              ? ocTheme.success
                              : ocTheme.textMuted,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                ),
              ),

              // Spent amount
              if (provider.extraUsage!.isEnabled) ...[
                _UsageBarVertical(
                  label: provider.extraUsage!.spentString,
                  subtitle: provider.extraUsage!.resetMonthString,
                  usedPercent: provider.extraUsage!.utilization ?? 0,
                  color: ocTheme.warning,
                  isMonetary: true,
                ),
              ],

              // Monthly limit info
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: ocTheme.backgroundElement,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Row(
                    children: [
                      Icon(
                        Icons.account_balance_wallet_outlined,
                        size: 20,
                        color: ocTheme.textMuted,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Monthly Limit',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 11,
                              ),
                            ),
                            Text(
                              provider.extraUsage!.limitString,
                              style: TextStyle(
                                color: ocTheme.text,
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      TextButton(
                        onPressed: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(
                              content: Text(
                                'Adjust your limit on claude.ai',
                                style: TextStyle(color: ocTheme.text),
                              ),
                              backgroundColor: ocTheme.backgroundPanel,
                              behavior: SnackBarBehavior.floating,
                            ),
                          );
                        },
                        style: TextButton.styleFrom(
                          foregroundColor: ocTheme.primary,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 8,
                          ),
                        ),
                        child: const Text('Adjust'),
                      ),
                    ],
                  ),
                ),
              ),
            ],

            // Credits section (OpenAI)
            if (provider.credits != null) ...[
              _SectionHeader(title: 'Credits'),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: ocTheme.backgroundElement,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: ocTheme.info.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          Icons.account_balance_wallet_rounded,
                          color: ocTheme.info,
                          size: 22,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Balance',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 11,
                              ),
                            ),
                            Text(
                              provider.credits!.balanceString,
                              style: TextStyle(
                                color: ocTheme.text,
                                fontSize: 22,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (provider.credits!.unlimited)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.success.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            'Unlimited',
                            style: TextStyle(
                              color: ocTheme.success,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ],
          ],

          // Not configured state
          if (!provider.hasUsageData && provider.error == null) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: ocTheme.backgroundElement,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: [
                    Icon(
                      Icons.info_outline_rounded,
                      color: ocTheme.textMuted,
                      size: 20,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        provider.providerId == 'claude'
                            ? 'Run `claude login` on your Mac to view usage.'
                            : 'Run `codex` on your Mac to authenticate.',
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Section header with title.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Text(
        title,
        style: TextStyle(
          color: ocTheme.textMuted,
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.3,
        ),
      ),
    );
  }
}

/// Usage bar with vertical layout - text on top, bar below.
class _UsageBarVertical extends StatelessWidget {
  const _UsageBarVertical({
    required this.label,
    this.subtitle,
    required this.usedPercent,
    required this.color,
    this.isMonetary = false,
  });

  final String label;
  final String? subtitle;
  final double usedPercent;
  final Color color;
  final bool isMonetary;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final clampedPercent = usedPercent.clamp(0.0, 100.0);

    // Determine color based on usage level
    Color barColor = color;
    if (clampedPercent >= 90) {
      barColor = ocTheme.error;
    } else if (clampedPercent >= 70) {
      barColor = ocTheme.warning;
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Top row: label and percentage
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      label,
                      style: TextStyle(
                        color: ocTheme.text,
                        fontSize: 14,
                        fontWeight: isMonetary
                            ? FontWeight.w600
                            : FontWeight.w500,
                      ),
                    ),
                    if (subtitle != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitle!,
                        style: TextStyle(
                          color: ocTheme.textMuted.withValues(alpha: 0.7),
                          fontSize: 11,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text(
                '${clampedPercent.round()}%',
                style: TextStyle(
                  color: barColor,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),

          const SizedBox(height: 8),

          // Progress bar
          Container(
            height: 6,
            decoration: BoxDecoration(
              color: ocTheme.backgroundElement,
              borderRadius: BorderRadius.circular(3),
            ),
            child: LayoutBuilder(
              builder: (context, constraints) {
                return Stack(
                  children: [
                    // Filled portion
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 300),
                      curve: Curves.easeOutCubic,
                      width: constraints.maxWidth * (clampedPercent / 100),
                      decoration: BoxDecoration(
                        color: barColor,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// Loading skeleton for provider card.
class _SkeletonProviderCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header skeleton
          Row(
            children: [
              _SkeletonBox(width: 40, height: 40, borderRadius: 10),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _SkeletonBox(width: 100, height: 16, borderRadius: 4),
                    const SizedBox(height: 6),
                    _SkeletonBox(width: 50, height: 14, borderRadius: 4),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 20),

          // Section header skeleton
          _SkeletonBox(width: 80, height: 12, borderRadius: 4),
          const SizedBox(height: 12),

          // Bar skeleton
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _SkeletonBox(width: 100, height: 14, borderRadius: 4),
                  _SkeletonBox(width: 30, height: 14, borderRadius: 4),
                ],
              ),
              const SizedBox(height: 8),
              _SkeletonBox(height: 6, borderRadius: 3),
            ],
          ),
          const SizedBox(height: 16),

          // Another bar skeleton
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  _SkeletonBox(width: 80, height: 14, borderRadius: 4),
                  _SkeletonBox(width: 30, height: 14, borderRadius: 4),
                ],
              ),
              const SizedBox(height: 8),
              _SkeletonBox(height: 6, borderRadius: 3),
            ],
          ),
        ],
      ),
    );
  }
}

/// Skeleton box for loading state.
class _SkeletonBox extends StatelessWidget {
  const _SkeletonBox({this.width, this.height, this.borderRadius = 8});

  final double? width;
  final double? height;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: ocTheme.text.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(borderRadius),
      ),
    );
  }
}
