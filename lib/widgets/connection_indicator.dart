import 'package:flutter/material.dart';

import '../services/websocket_service.dart';
import '../theme/opencode_theme.dart';

class ConnectionIndicator extends StatelessWidget {
  const ConnectionIndicator({
    super.key,
    required this.status,
    required this.opencodeRunning,
    this.isReconnecting = false,
    this.rttMs,
    this.compact = false,
  });

  final ConnectionStatus status;
  final bool opencodeRunning;
  final bool isReconnecting;
  final int? rttMs;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final color = switch (status) {
      ConnectionStatus.connected =>
        opencodeRunning ? theme.success : theme.warning,
      ConnectionStatus.connecting => theme.warning,
      ConnectionStatus.disconnected => theme.error,
    };

    final baseLabel = switch (status) {
      ConnectionStatus.connected =>
        opencodeRunning ? 'Online' : 'Agent offline',
      ConnectionStatus.connecting =>
        isReconnecting ? 'Reconnecting' : 'Connecting',
      ConnectionStatus.disconnected => 'Offline',
    };

    final label = (status == ConnectionStatus.connected && rttMs != null)
        ? '$baseLabel · ${rttMs}ms'
        : baseLabel;

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
          Text(label, style: Theme.of(context).textTheme.labelSmall),
        ],
      ],
    );
  }
}
