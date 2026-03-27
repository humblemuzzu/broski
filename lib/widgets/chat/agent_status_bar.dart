import 'package:flutter/material.dart';

import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

/// Shared status bar showing latency pill + model selector pill.
///
/// Used across all agent actions sheets (CC, Codex, Pi, OpenCode).
/// [leading] allows extra widgets before the latency pill (e.g. branch info).
/// [bottomPadding] defaults to 16 but can be overridden (Pi uses 12).
class AgentStatusBar extends StatelessWidget {
  const AgentStatusBar({
    super.key,
    required this.theme,
    required this.isConnected,
    required this.rttMs,
    required this.modelName,
    required this.modelColor,
    required this.onModelTap,
    this.leading,
    this.bottomPadding = 16,
  });

  final OpenCodeTheme theme;
  final bool isConnected;
  final int? rttMs;
  final String modelName;
  final Color modelColor;
  final VoidCallback? onModelTap;
  final Widget? leading;
  final double bottomPadding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 8, 20, bottomPadding),
      child: Row(
        children: [
          // Optional leading widget (e.g. branch info)
          if (leading != null) leading!,
          // Latency pill
          if (isConnected && rttMs != null) ...[
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
              decoration: BoxDecoration(
                color: theme.info.withValues(alpha: 0.1),
                borderRadius: Radii.brSm,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(AppIcons.speed, size: 14, color: theme.info),
                  const SizedBox(width: 6),
                  Text(
                    '${rttMs}ms',
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.info,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ],
          const Spacer(),
          // Model selector pill
          GestureDetector(
            onTap: onModelTap,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: modelColor.withValues(alpha: 0.1),
                borderRadius: Radii.brSm,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(AppIcons.autoAwesome, size: 14, color: modelColor),
                  const SizedBox(width: 6),
                  Text(
                    modelName,
                    style: TextStyle(
                      fontSize: 12,
                      color: modelColor,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  SizedBox(width: Spacing.xs),
                  Icon(AppIcons.chevronRight, size: 16, color: modelColor),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
