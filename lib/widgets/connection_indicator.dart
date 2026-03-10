import 'package:flutter/material.dart';

import '../services/websocket_service.dart';
import '../theme/app_typography.dart';
import '../theme/opencode_theme.dart';

class ConnectionIndicator extends StatelessWidget {
  const ConnectionIndicator({
    super.key,
    required this.status,
    required this.agentAvailable,
    this.isReconnecting = false,
    this.rttMs,
    this.compact = false,
    this.agentLabel,
  });

  final ConnectionStatus status;
  final bool agentAvailable;
  final bool isReconnecting;
  final int? rttMs;
  final bool compact;
  final String? agentLabel;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final color = switch (status) {
      ConnectionStatus.connected =>
        agentAvailable ? theme.success : theme.warning,
      ConnectionStatus.connecting => theme.warning,
      ConnectionStatus.disconnected => theme.error,
    };

    final baseLabel = switch (status) {
      ConnectionStatus.connected => agentAvailable ? 'Online' : 'Agent offline',
      ConnectionStatus.connecting =>
        isReconnecting ? 'Reconnecting' : 'Connecting',
      ConnectionStatus.disconnected => 'Offline',
    };

    final labeled = (agentLabel != null && status == ConnectionStatus.connected)
        ? '${agentLabel!} · $baseLabel'
        : baseLabel;

    final label = (status == ConnectionStatus.connected && rttMs != null)
        ? '$labeled · ${rttMs}ms'
        : labeled;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        if (!compact) ...[
          const SizedBox(width: 6),
          Text(label, style: AppTypography.labelSmall(color: theme.textMuted)),
        ],
      ],
    );
  }
}
