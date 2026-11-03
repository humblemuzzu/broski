import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// How a session status reads and which theme colour marks it.
({String label, Color color}) statusLook(
  SessionStatus status,
  OpenCodeTheme theme,
) => switch (status) {
  SessionStatus.idle => (label: 'Idle', color: theme.textMuted),
  SessionStatus.running => (label: 'Running', color: theme.primary),
  SessionStatus.waitingForUser => (
    label: 'Waiting for you',
    color: theme.warning,
  ),
  SessionStatus.suspended => (label: 'Suspended', color: theme.info),
  SessionStatus.unknown => (label: 'Unknown', color: theme.textMuted),
};

Color noticeColor(NoticeLevel level, OpenCodeTheme theme) => switch (level) {
  NoticeLevel.info => theme.info,
  NoticeLevel.warning => theme.warning,
  NoticeLevel.error => theme.error,
};

/// A small rounded label in [color].
class StatusPill extends StatelessWidget {
  const StatusPill({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: Insets.chip,
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.12),
      borderRadius: Radii.brFull,
    ),
    child: Text(label, style: AppTypography.label(color: color)),
  );
}
