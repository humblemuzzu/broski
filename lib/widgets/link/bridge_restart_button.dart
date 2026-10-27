import 'dart:async';

import 'package:broski/providers/connection/link_control_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// How long the control stays disabled after a tap: the daemon restarts the
/// bridge at once, so a second tap only asks it again.
const Duration bridgeRestartCooldown = Duration(seconds: 5);

/// The control that asks the daemon to start the bridge again, shown while the
/// bridge is crashed.
class BridgeRestartButton extends StatefulWidget {
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
  State<BridgeRestartButton> createState() => _BridgeRestartButtonState();
}

class _BridgeRestartButtonState extends State<BridgeRestartButton> {
  Timer? _cooldown;

  @override
  void dispose() {
    _cooldown?.cancel();
    super.dispose();
  }

  void _restart() {
    if (_cooldown?.isActive ?? false) return;
    widget.send(bridgeRestartControl);
    setState(() {
      _cooldown = Timer(bridgeRestartCooldown, () {
        if (mounted) setState(() {});
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final tint = widget.color ?? theme.warning;
    final busy = _cooldown?.isActive ?? false;
    final detail = widget.detail;
    return Semantics(
      button: true,
      enabled: !busy,
      excludeSemantics: true,
      label: detail == null
          ? 'Restart the bridge'
          : 'Restart the bridge: $detail',
      child: Tooltip(
        message: detail == null ? 'Restart the bridge' : 'Restart: $detail',
        child: InkWell(
          onTap: busy ? null : _restart,
          borderRadius: Radii.brSm,
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minWidth: Spacing.minTouchTarget,
              minHeight: Spacing.minTouchTarget,
            ),
            child: Padding(
              padding: Insets.chip,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    busy ? AppIcons.sync : AppIcons.restart,
                    size: 14,
                    color: tint,
                  ),
                  const SizedBox(width: Spacing.xs),
                  Flexible(
                    child: Text(
                      busy ? 'Restarting…' : _label(detail),
                      overflow: TextOverflow.ellipsis,
                      style: AppTypography.labelSmall(color: tint),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// The crash reason rides in the chip rather than only in a tooltip, which a
  /// touch screen never shows.
  String _label(String? detail) {
    final reason = detail?.trim();
    if (reason == null || reason.isEmpty) return 'Restart';
    return 'Restart · $reason';
  }
}
