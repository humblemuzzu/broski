import 'package:broski/models/session.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// ============================================================
// Active Sessions Section
// ============================================================
// Shows sessions that are currently running (busy status).
// Displays at the top of the sessions list.
class ActiveSessionsSection extends ConsumerWidget {
  const ActiveSessionsSection({
    super.key,
    this.onSessionTap,
    this.currentSessionId,
  });
  final void Function(SessionSummary session)? onSessionTap;
  final String? currentSessionId; // Exclude current session from list
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    final sessionsAsync = ref.watch(sessionsListProvider);
    final sessions = sessionsAsync.valueOrNull ?? [];
    // Find sessions that are busy or retrying
    final activeSessions = sessions.where((session) {
      if (session.id == currentSessionId) return false; // Exclude current
      final status = sessionStatuses[session.id];
      return status != null && (status.isBusy || status.isRetry);
    }).toList();
    // Don't show if no active sessions
    if (activeSessions.isEmpty) {
      return const SizedBox.shrink();
    }
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      padding: Insets.card,
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.info.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          Row(
            children: [
              _PulsingIcon(color: ocTheme.info, icon: AppIcons.play),
              const SizedBox(width: Spacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Running',
                      style: TextStyle(
                        color: ocTheme.text,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      '${activeSessions.length} session${activeSessions.length > 1 ? 's' : ''} active',
                      style: TextStyle(color: ocTheme.info, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: Spacing.md),
          // Active sessions list
          ...activeSessions.map((session) {
            final status = sessionStatuses[session.id];
            return Padding(
              padding: Insets.bottomSm,
              child: _ActiveSessionCard(
                session: session,
                status: status,
                onTap: onSessionTap != null
                    ? () => onSessionTap!(session)
                    : null,
              ),
            );
          }),
        ],
      ),
    );
  }
}

// ============================================================
// Active Session Card
// ============================================================
// Compact card for a running session.
class _ActiveSessionCard extends StatelessWidget {
  const _ActiveSessionCard({required this.session, this.status, this.onTap});
  final SessionSummary session;
  final SessionStatus? status;
  final VoidCallback? onTap;
  String _getProjectName() {
    return session.directory.split('/').where((item) => item.isNotEmpty).last;
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final isRetry = status?.isRetry ?? false;
    final statusColor = isRetry ? ocTheme.warning : ocTheme.info;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: ocTheme.backgroundElement,
          borderRadius: Radii.brMd,
          border: Border.all(color: statusColor.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            // Status indicator
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: statusColor,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: statusColor.withValues(alpha: 0.5),
                    blurRadius: 4,
                    spreadRadius: 1,
                  ),
                ],
              ),
            ),
            const SizedBox(width: Spacing.md),
            // Session info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.title,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 13,
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: Spacing.xxs),
                  Row(
                    children: [
                      Text(
                        _getProjectName(),
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 11,
                        ),
                      ),
                      if (isRetry) ...[
                        const SizedBox(width: Spacing.sm),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.warning.withValues(alpha: 0.15),
                            borderRadius: Radii.brXs,
                          ),
                          child: Text(
                            'Retrying',
                            style: TextStyle(
                              color: ocTheme.warning,
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
            // Arrow
            Icon(
              AppIcons.chevronRight,
              color: ocTheme.textMuted.withValues(alpha: 0.5),
              size: 18,
            ),
          ],
        ),
      ),
    );
  }
}

// ============================================================
// Floating Active Indicator
// ============================================================
// Mini-player style bar that appears when there are active sessions
// (other than the one currently being viewed).
class FloatingActiveIndicator extends ConsumerWidget {
  const FloatingActiveIndicator({
    super.key,
    required this.onTap,
    this.currentSessionId,
  });
  final VoidCallback onTap;
  final String? currentSessionId; // Exclude from count
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    // Count active sessions excluding current
    final activeCount = sessionStatuses.entries.where((entry) {
      if (entry.key == currentSessionId) return false;
      return entry.value.isBusy || entry.value.isRetry;
    }).length;
    if (activeCount == 0) {
      return const SizedBox.shrink();
    }
    final ocTheme = OpenCodeTheme.of(context);
    return Positioned(
      left: 16,
      right: 16,
      bottom: 100, // Above input bar
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: Insets.section,
          decoration: BoxDecoration(
            color: ocTheme.backgroundPanel,
            borderRadius: Radii.brLg,
            border: Border.all(color: ocTheme.info.withValues(alpha: 0.4)),
            boxShadow: [
              BoxShadow(
                color: ocTheme.bgDeep.withValues(alpha: 0.3),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              // Pulsing indicator
              _PulsingIcon(color: ocTheme.info, icon: AppIcons.play),
              const SizedBox(width: Spacing.md),
              // Text
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '$activeCount other session${activeCount > 1 ? 's' : ''} running',
                      style: TextStyle(
                        color: ocTheme.text,
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      'Tap to view',
                      style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
                    ),
                  ],
                ),
              ),
              // Arrow
              Icon(AppIcons.forward, color: ocTheme.info, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

// ============================================================
// Helper Widgets
// ============================================================
/// Pulsing icon widget for active sessions
class _PulsingIcon extends StatefulWidget {
  const _PulsingIcon({required this.color, required this.icon});
  final Color color;
  final IconData icon;
  @override
  State<_PulsingIcon> createState() => _PulsingIconState();
}

class _PulsingIconState extends State<_PulsingIcon>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _animation = Tween<double>(
      begin: 0.5,
      end: 1.0,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: widget.color.withValues(alpha: _animation.value * 0.4),
                blurRadius: 8,
                spreadRadius: 1,
              ),
            ],
          ),
          child: Icon(widget.icon, color: widget.color, size: 20),
        );
      },
    );
  }
}
