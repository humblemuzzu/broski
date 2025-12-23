import 'package:flutter/material.dart';

import '../services/websocket_service.dart';
import '../theme/colors.dart';

class ConnectionIndicator extends StatelessWidget {
  const ConnectionIndicator({
    super.key,
    required this.status,
    required this.opencodeRunning,
    this.compact = false,
  });

  final ConnectionStatus status;
  final bool opencodeRunning;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      ConnectionStatus.connected => opencodeRunning ? BroskiColors.mint : BroskiColors.gold,
      ConnectionStatus.connecting => BroskiColors.gold,
      ConnectionStatus.disconnected => BroskiColors.ember,
    };

    final label = switch (status) {
      ConnectionStatus.connected => opencodeRunning ? 'Online' : 'Agent offline',
      ConnectionStatus.connecting => 'Connecting',
      ConnectionStatus.disconnected => 'Offline',
    };

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
          ),
        ),
        if (!compact) ...[
          const SizedBox(width: 6),
          Text(label, style: Theme.of(context).textTheme.labelSmall),
        ],
      ],
    );
  }
}
