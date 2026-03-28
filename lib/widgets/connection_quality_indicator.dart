import 'package:broski/models/connection_quality.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class ConnectionQualityIndicator extends ConsumerWidget {
  const ConnectionQualityIndicator({super.key, this.compact = false});
  final bool compact;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(connectionProvider);
    final theme = Theme.of(context).extension<OpenCodeTheme>()!;
    if (!state.isConnected) {
      return _buildDisconnectedIndicator(theme);
    }
    final rttMs = state.rttMs ?? 0;
    final quality = ConnectionMetrics.calculateQuality(rttMs);
    final type = state.connectionType;
    final metrics = ConnectionMetrics(
      type: type,
      rttMs: rttMs,
      quality: quality,
      lastPingAt: DateTime.now(),
    );
    if (compact) {
      return _buildCompactIndicator(metrics, theme);
    }
    return Container(
      padding: Insets.chip,
      decoration: BoxDecoration(
        color: metrics.resolveQualityColor(theme).withValues(alpha: 0.1),
        borderRadius: Radii.brMd,
        border: Border.all(
          color: metrics.resolveQualityColor(theme).withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _SignalBars(
            bars: metrics.signalBars,
            color: metrics.resolveQualityColor(theme),
          ),
          const SizedBox(width: 6),
          Icon(metrics.typeIcon, size: 14, color: theme.textMuted),
          const SizedBox(width: Spacing.xs),
          Text(
            '${metrics.rttMs}ms',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: theme.textMuted,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCompactIndicator(
    ConnectionMetrics metrics,
    OpenCodeTheme theme,
  ) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _SignalBars(
          bars: metrics.signalBars,
          color: metrics.resolveQualityColor(theme),
          height: 12,
        ),
        const SizedBox(width: Spacing.xs),
        Text(
          '${metrics.rttMs}ms',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w500,
            color: theme.textMuted,
          ),
        ),
      ],
    );
  }

  Widget _buildDisconnectedIndicator(OpenCodeTheme theme) {
    return Container(
      padding: Insets.chip,
      decoration: BoxDecoration(
        color: theme.error.withValues(alpha: 0.1),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(AppIcons.signalOff, size: 14, color: theme.error),
          const SizedBox(width: Spacing.xs),
          Text(
            'Disconnected',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: theme.error,
            ),
          ),
        ],
      ),
    );
  }
}

class _SignalBars extends StatelessWidget {
  const _SignalBars({
    required this.bars,
    required this.color,
    this.height = 18,
  });
  final int bars;
  final Color color;
  final double height;
  @override
  Widget build(BuildContext context) {
    final barHeights = [height * 0.33, height * 0.55, height * 0.77, height];
    return Row(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: List.generate(4, (index) {
        final isFilled = index < bars;
        return Padding(
          padding: EdgeInsets.only(right: index < 3 ? 2 : 0),
          child: Container(
            width: 4,
            height: barHeights[index],
            decoration: BoxDecoration(
              color: isFilled ? color : color.withValues(alpha: 0.2),
              borderRadius: Radii.brXs,
            ),
          ),
        );
      }),
    );
  }
}

class ConnectionTypeBadge extends ConsumerWidget {
  const ConnectionTypeBadge({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(connectionProvider);
    final theme = Theme.of(context).extension<OpenCodeTheme>()!;
    if (!state.isConnected) {
      return const SizedBox.shrink();
    }
    final type = state.connectionType;
    final rttMs = state.rttMs ?? 0;
    String label = 'Connected';
    IconData icon = AppIcons.signal;
    switch (type) {
      case ConnectionType.local:
        label = 'Local';
        icon = AppIcons.wifi;
      case ConnectionType.hotspot:
        label = 'Hotspot';
        icon = AppIcons.network;
      case ConnectionType.tailscale:
        label = 'Tailscale';
        icon = AppIcons.vpn;
      case ConnectionType.magicDNS:
        label = 'MagicDNS';
        icon = AppIcons.dns;
      case ConnectionType.unknown:
        label = 'Connected';
        icon = AppIcons.signal;
    }
    return Container(
      padding: Insets.chip,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: theme.textMuted),
          const SizedBox(width: Spacing.xs),
          Text(
            '$label • ${rttMs}ms',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: theme.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}
