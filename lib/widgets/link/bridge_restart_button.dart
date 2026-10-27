import 'package:broski/providers/connection/link_control_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The control that asks the daemon to start the bridge again, shown while the
/// bridge is crashed.
class BridgeRestartButton extends StatelessWidget {
  const BridgeRestartButton({
    super.key,
    required this.send,
    this.detail,
    this.color,
  });

  final LinkControlSend send;

  /// Why the bridge crashed, from the daemon.
  final String? detail;

  final Color? color;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final tint = color ?? theme.warning;
    final detail = this.detail;
    return Tooltip(
      message: detail == null ? 'Restart the bridge' : 'Restart: $detail',
      child: InkWell(
        onTap: () => send(bridgeRestartControl),
        borderRadius: Radii.brSm,
        child: Padding(
          padding: Insets.chip,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(AppIcons.restart, size: 14, color: tint),
              const SizedBox(width: Spacing.xs),
              Text('Restart', style: AppTypography.labelSmall(color: tint)),
            ],
          ),
        ),
      ),
    );
  }
}
