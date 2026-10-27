import 'package:broski/services/websocket_service.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/link/link_status_presentation.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter/material.dart';

class ConnectionIndicator extends StatelessWidget {
  const ConnectionIndicator({
    super.key,
    required this.status,
    required this.agentAvailable,
    this.isReconnecting = false,
    this.rttMs,
    this.compact = false,
    this.agentLabel,
    this.bridge,
  });

  final ConnectionStatus status;
  final bool agentAvailable;
  final bool isReconnecting;
  final int? rttMs;
  final bool compact;
  final String? agentLabel;

  /// The machine's bridge process: while it is not up, nothing on the other
  /// side can answer, whatever the connection says.
  final BridgeLinkStatus? bridge;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final bridge = this.bridge;
    final color = switch (bridge?.state) {
      BridgeStatusState.crashed || BridgeStatusState.down => theme.error,
      BridgeStatusState.starting ||
      BridgeStatusState.connecting ||
      BridgeStatusState.unknown => theme.warning,
      BridgeStatusState.up || null => switch (status) {
        ConnectionStatus.connected =>
          agentAvailable ? theme.success : theme.warning,
        ConnectionStatus.connecting => theme.warning,
        ConnectionStatus.disconnected => theme.error,
      },
    };

    final baseLabel =
        (bridge == null ? null : bridgeStatusLabel(bridge)) ??
        switch (status) {
          ConnectionStatus.connected =>
            agentAvailable ? 'Online' : 'Agent offline',
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
