import 'package:broski/providers/connection/bridge_status_provider.dart';
import 'package:broski/providers/connection/link_control_provider.dart';
import 'package:broski/providers/link/link_status_provider.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/link/bridge_restart_button.dart';
import 'package:broski/widgets/link/link_status_presentation.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The app's connection, in one line: the link, and the machine's bridge when
/// that is what is in the way.
class ConnectionIndicator extends ConsumerWidget {
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
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final link = ref.watch(linkStatusProvider);
    final bridge = ref.watch(bridgeLinkStatusProvider);
    // A bridge status outlives the link that reported it: only a connected link
    // is waiting on its bridge.
    final carried = link != null && connectionHoldsBridge(link) ? bridge : null;
    final tone = carried == null
        ? _connectionTone()
        : bridgeTone(carried.state);
    final color = tone.color(theme);
    final label = _label(carried);
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
        if (canRestartBridge(link, bridge))
          BridgeRestartButton(
            send: ref.watch(linkControlSendProvider),
            detail: bridge?.detail,
            color: color,
          ),
      ],
    );
  }

  LinkStatusTone _connectionTone() => switch (status) {
    ConnectionStatus.connected =>
      agentAvailable ? LinkStatusTone.ok : LinkStatusTone.pending,
    ConnectionStatus.connecting => LinkStatusTone.pending,
    ConnectionStatus.disconnected => LinkStatusTone.down,
  };

  String _label(BridgeLinkStatus? bridge) {
    final base =
        (bridge == null ? null : bridgeStatusLabel(bridge)) ??
        switch (status) {
          ConnectionStatus.connected =>
            agentAvailable ? 'Online' : 'Agent offline',
          ConnectionStatus.connecting =>
            isReconnecting ? 'Reconnecting' : 'Connecting',
          ConnectionStatus.disconnected => 'Offline',
        };
    final labeled = agentLabel != null && status == ConnectionStatus.connected
        ? '${agentLabel!} · $base'
        : base;
    return status == ConnectionStatus.connected && rttMs != null
        ? '$labeled · ${rttMs}ms'
        : labeled;
  }
}
