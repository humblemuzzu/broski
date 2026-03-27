import 'package:broski/utils/format_utils.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/pi.dart';
import '../../providers/pi_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../widgets/chat/section_header.dart';

Future<void> showPiSessionSidebarSheet({
  required BuildContext context,
  required String cwd,
  required String currentSessionId,
  required PiState? state,
  required void Function(PiSessionInfo session) onOpenSession,
  required void Function(String entryId) onForkFromEntry,
}) {
  return DetailSheet.show(
    context: context,
    title: 'Session',
    initialSize: 0.75,
    child: _PiSessionSidebarContent(
      cwd: cwd,
      currentSessionId: currentSessionId,
      state: state,
      onOpenSession: onOpenSession,
      onForkFromEntry: onForkFromEntry,
    ),
  );
}

class _PiSessionSidebarContent extends ConsumerStatefulWidget {
  const _PiSessionSidebarContent({
    required this.cwd,
    required this.currentSessionId,
    required this.state,
    required this.onOpenSession,
    required this.onForkFromEntry,
  });

  final String cwd;
  final String currentSessionId;
  final PiState? state;
  final void Function(PiSessionInfo session) onOpenSession;
  final void Function(String entryId) onForkFromEntry;

  @override
  ConsumerState<_PiSessionSidebarContent> createState() =>
      _PiSessionSidebarContentState();
}

class _PiSessionSidebarContentState
    extends ConsumerState<_PiSessionSidebarContent> {
  bool _loadingForks = true;
  List<PiForkMessage> _forkMessages = const [];

  @override
  void initState() {
    super.initState();
    _loadForks();
  }

  Future<void> _loadForks() async {
    setState(() => _loadingForks = true);
    try {
      final bridge = ref.read(piBridgeServiceProvider);
      final forks = await bridge.getForkMessages(projectPath: widget.cwd);
      if (!mounted) return;
      setState(() {
        _forkMessages = forks;
        _loadingForks = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _forkMessages = const [];
        _loadingForks = false;
      });
    }
  }

  Future<void> _toggleSteeringMode() async {
    final currentState =
        ref.read(piStateProvider(widget.cwd)).valueOrNull ?? widget.state;
    final current = currentState?.steeringMode ?? 'all';
    final next = current == 'all' ? 'one-at-a-time' : 'all';
    final bridge = ref.read(piBridgeServiceProvider);
    await bridge.setSteeringMode(mode: next, projectPath: widget.cwd);
    ref.invalidate(piStateProvider(widget.cwd));
  }

  Future<void> _toggleFollowUpMode() async {
    final currentState =
        ref.read(piStateProvider(widget.cwd)).valueOrNull ?? widget.state;
    final current = currentState?.followUpMode ?? 'all';
    final next = current == 'all' ? 'one-at-a-time' : 'all';
    final bridge = ref.read(piBridgeServiceProvider);
    await bridge.setFollowUpMode(mode: next, projectPath: widget.cwd);
    ref.invalidate(piStateProvider(widget.cwd));
  }

  Future<void> _toggleAutoRetry() async {
    final currentState =
        ref.read(piStateProvider(widget.cwd)).valueOrNull ?? widget.state;
    final current = currentState?.autoRetryEnabled ?? true;
    final bridge = ref.read(piBridgeServiceProvider);
    await bridge.setAutoRetry(enabled: !current, projectPath: widget.cwd);
    ref.invalidate(piStateProvider(widget.cwd));
  }

  Future<void> _toggleAutoCompaction() async {
    final currentState =
        ref.read(piStateProvider(widget.cwd)).valueOrNull ?? widget.state;
    final current = currentState?.autoCompactionEnabled ?? true;
    final bridge = ref.read(piBridgeServiceProvider);
    await bridge.setAutoCompaction(enabled: !current, projectPath: widget.cwd);
    ref.invalidate(piStateProvider(widget.cwd));
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final sessionsAsync = ref.watch(piSessionsProvider(null));
    final statsAsync = ref.watch(piSessionStatsProvider(widget.cwd));
    final liveState = ref.watch(piStateProvider(widget.cwd)).valueOrNull;
    final effectiveState = liveState ?? widget.state;

    return ListView(
      shrinkWrap: true,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      children: [
        // ── Session Stats ─────────────────────────────────────────
        statsAsync.when(
          data: (stats) => _buildStatsCard(theme, stats, effectiveState),
          loading: () => _buildStatsCardLoading(theme),
          error: (_, __) => const SizedBox.shrink(),
        ),
        SizedBox(height: Spacing.lg),

        // ── Runtime Controls ──────────────────────────────────────
        SectionHeader(title: 'CONTROLS', theme: theme),
        SizedBox(height: Spacing.sm),
        _buildControlsGrid(theme, effectiveState),
        SizedBox(height: Spacing.lg),

        // ── Fork Points ───────────────────────────────────────────
        Row(
          children: [
            SectionHeader(title: 'FORK POINTS', theme: theme),
            const Spacer(),
            GestureDetector(
              onTap: _loadForks,
              child: Icon(AppIcons.refresh, size: 16, color: theme.textMuted),
            ),
          ],
        ),
        SizedBox(height: Spacing.sm),
        if (_loadingForks)
          Padding(
            padding: Insets.cardV,
            child: LinearProgressIndicator(
              minHeight: 2,
              color: theme.primary,
              backgroundColor: theme.backgroundElement,
            ),
          )
        else if (_forkMessages.isEmpty)
          _buildEmptyState(theme, 'No fork points yet')
        else
          ...(_forkMessages
              .take(8)
              .map((entry) => _buildForkTile(theme, entry))),
        SizedBox(height: Spacing.lg),

        // ── Session History ───────────────────────────────────────
        SectionHeader(title: 'SESSION HISTORY', theme: theme),
        SizedBox(height: Spacing.sm),
        sessionsAsync.when(
          data: (sessions) {
            final sorted = [...sessions]
              ..sort((a, b) => b.modified.compareTo(a.modified));
            if (sorted.isEmpty) {
              return _buildEmptyState(theme, 'No sessions yet');
            }
            return Column(
              children: sorted
                  .take(10)
                  .map((s) => _buildSessionTile(theme, s))
                  .toList(),
            );
          },
          loading: () => Padding(
            padding: Insets.cardV,
            child: LinearProgressIndicator(
              minHeight: 2,
              color: theme.primary,
              backgroundColor: theme.backgroundElement,
            ),
          ),
          error: (e, _) => _buildEmptyState(theme, 'Failed to load sessions'),
        ),
      ],
    );
  }

  Widget _buildStatsCard(
    OpenCodeTheme theme,
    PiSessionStats stats,
    PiState? piState,
  ) {
    // Use the SDK's getContextUsage() which estimates actual tokens in the
    // context window (via last assistant usage + trailing message estimates).
    // Falls back to cumulative input tokens only if SDK data unavailable.
    final ctxUsage = stats.contextUsage;
    final contextWindow =
        ctxUsage?.contextWindow ??
        piState?.model?.contextWindow ??
        kDefaultContextWindow;
    final contextUsed = ctxUsage?.tokens ?? stats.tokens.input;
    final contextPercent =
        ctxUsage?.percent ??
        (contextWindow > 0
            ? (contextUsed / contextWindow * 100).clamp(0.0, 100.0)
            : 0.0);
    final costStr = stats.cost > 0
        ? '\$${stats.cost.toStringAsFixed(4)}'
        : 'Free';

    return Container(
      padding: Insets.cardMd,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Context usage bar
          Row(
            children: [
              Icon(AppIcons.memory, size: 14, color: theme.info),
              SizedBox(width: Spacing.sm),
              Text(
                'Context',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: theme.text,
                ),
              ),
              const Spacer(),
              Text(
                '${formatTokens(contextUsed)} / ${formatTokens(contextWindow)}',
                style: AppTypography.caption(color: theme.textMuted),
              ),
            ],
          ),
          SizedBox(height: Spacing.sm),
          ClipRRect(
            borderRadius: Radii.brXs,
            child: LinearProgressIndicator(
              value: contextPercent / 100,
              minHeight: 6,
              color: contextPercent > 80
                  ? theme.error
                  : contextPercent > 50
                  ? theme.warning
                  : theme.info,
              backgroundColor: theme.backgroundElement,
            ),
          ),
          SizedBox(height: Spacing.md),
          // Token breakdown + cost row
          Row(
            children: [
              _StatChip(
                label: 'In',
                value: formatTokens(stats.tokens.input),
                theme: theme,
              ),
              SizedBox(width: Spacing.sm),
              _StatChip(
                label: 'Out',
                value: formatTokens(stats.tokens.output),
                theme: theme,
              ),
              if (stats.tokens.cacheRead > 0) ...[
                SizedBox(width: Spacing.sm),
                _StatChip(
                  label: 'Cache',
                  value: formatTokens(stats.tokens.cacheRead),
                  theme: theme,
                ),
              ],
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: theme.success.withValues(alpha: 0.1),
                  borderRadius: Radii.brSm,
                ),
                child: Text(
                  costStr,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: theme.success,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: Spacing.sm),
          // Message counts
          Row(
            children: [
              Text(
                '${stats.totalMessages} messages',
                style: AppTypography.caption(color: theme.textMuted),
              ),
              Text(
                ' • ${stats.userMessages} user',
                style: AppTypography.caption(color: theme.textMuted),
              ),
              Text(
                ' • ${stats.toolCalls} tools',
                style: AppTypography.caption(color: theme.textMuted),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatsCardLoading(OpenCodeTheme theme) {
    return Container(
      padding: Insets.cardMd,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Center(
        child: Padding(
          padding: Insets.cardV,
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: theme.primary,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildControlsGrid(OpenCodeTheme theme, PiState? state) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        _ControlChip(
          icon: AppIcons.explore,
          label: 'Steering',
          value: state?.steeringMode ?? 'all',
          theme: theme,
          onTap: _toggleSteeringMode,
        ),
        _ControlChip(
          icon: AppIcons.send,
          label: 'Follow-up',
          value: state?.followUpMode ?? 'all',
          theme: theme,
          onTap: _toggleFollowUpMode,
        ),
        _ControlChip(
          icon: AppIcons.refresh,
          label: 'Auto-retry',
          value: (state?.autoRetryEnabled ?? true) ? 'on' : 'off',
          theme: theme,
          onTap: _toggleAutoRetry,
        ),
        _ControlChip(
          icon: AppIcons.compress,
          label: 'Auto-compact',
          value: (state?.autoCompactionEnabled ?? true) ? 'on' : 'off',
          theme: theme,
          onTap: _toggleAutoCompaction,
        ),
      ],
    );
  }

  Widget _buildForkTile(OpenCodeTheme theme, PiForkMessage entry) {
    return GestureDetector(
      onTap: () {
        Navigator.pop(context);
        widget.onForkFromEntry(entry.entryId);
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: EdgeInsets.symmetric(horizontal: Spacing.md, vertical: 10),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          children: [
            Icon(AppIcons.callSplit, size: 14, color: theme.warning),
            SizedBox(width: Spacing.sm),
            Expanded(
              child: Text(
                entry.text,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.bodySmall(color: theme.text),
              ),
            ),
            Icon(
              AppIcons.chevronRight,
              size: 16,
              color: theme.textMuted.withValues(alpha: 0.5),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSessionTile(OpenCodeTheme theme, PiSessionInfo session) {
    final isCurrent = session.id == widget.currentSessionId;
    final title = (session.name ?? '').trim().isNotEmpty
        ? session.name!.trim()
        : session.firstMessage.trim().isNotEmpty
        ? session.firstMessage.trim()
        : session.id.length > 8
        ? session.id.substring(0, 8)
        : session.id;

    return GestureDetector(
      onTap: () {
        Navigator.pop(context);
        widget.onOpenSession(session);
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 6),
        padding: EdgeInsets.symmetric(horizontal: Spacing.md, vertical: 10),
        decoration: BoxDecoration(
          color: isCurrent
              ? theme.primary.withValues(alpha: 0.08)
              : theme.backgroundPanel,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isCurrent
                ? theme.primary.withValues(alpha: 0.4)
                : theme.borderSubtle,
          ),
        ),
        child: Row(
          children: [
            Icon(
              isCurrent ? AppIcons.radioChecked : AppIcons.chatBubble,
              size: 14,
              color: isCurrent ? theme.primary : theme.textMuted,
            ),
            SizedBox(width: Spacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: isCurrent ? FontWeight.w600 : FontWeight.w500,
                      color: isCurrent ? theme.primary : theme.text,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    '${session.messageCount} msgs • ${_formatTimeAgo(session.modified)}',
                    style: AppTypography.caption(color: theme.textMuted),
                  ),
                ],
              ),
            ),
            Icon(
              AppIcons.chevronRight,
              size: 16,
              color: theme.textMuted.withValues(alpha: 0.5),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState(OpenCodeTheme theme, String text) {
    return Padding(
      padding: Insets.cardMd,
      child: Center(
        child: Text(text, style: AppTypography.caption(color: theme.textMuted)),
      ),
    );
  }

  String _formatTimeAgo(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${dt.month}/${dt.day}';
  }
}

class _StatChip extends StatelessWidget {
  const _StatChip({
    required this.label,
    required this.value,
    required this.theme,
  });
  final String label;
  final String value;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brSm,
      ),
      child: Text(
        '$label $value',
        style: TextStyle(
          fontSize: 11,
          color: theme.textMuted,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

class _ControlChip extends StatelessWidget {
  const _ControlChip({
    required this.icon,
    required this.label,
    required this.value,
    required this.theme,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final String value;
  final OpenCodeTheme theme;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final isOn = value == 'on' || value == 'all';
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isOn
              ? theme.primary.withValues(alpha: 0.1)
              : theme.backgroundPanel,
          borderRadius: Radii.brSm,
          border: Border.all(
            color: isOn
                ? theme.primary.withValues(alpha: 0.4)
                : theme.borderSubtle,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: isOn ? theme.primary : theme.textMuted),
            SizedBox(width: Spacing.xs),
            Text(
              '$label: $value',
              style: TextStyle(
                fontSize: 12,
                fontWeight: isOn ? FontWeight.w600 : FontWeight.w500,
                color: isOn ? theme.primary : theme.text,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
