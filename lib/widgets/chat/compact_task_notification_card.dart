import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../theme/opencode_theme.dart';

/// Compact inline card for Claude Code agent team task notifications.
/// Shows task status (running/completed/failed/stopped) with optional stop action.
class CompactTaskNotificationCard extends ConsumerWidget {
  final String taskId;
  final String status;
  final String summary;
  final VoidCallback? onStop;

  const CompactTaskNotificationCard({
    super.key,
    required this.taskId,
    required this.status,
    required this.summary,
    this.onStop,
  });

  Color _statusColor(OpenCodeTheme theme) {
    switch (status) {
      case 'completed':
        return theme.success;
      case 'failed':
        return theme.error;
      case 'stopped':
        return theme.textMuted;
      default:
        return theme.accent;
    }
  }

  IconData _statusIcon() {
    switch (status) {
      case 'completed':
        return Icons.check_circle_outline_rounded;
      case 'failed':
        return Icons.error_outline_rounded;
      case 'stopped':
        return Icons.stop_circle_outlined;
      default:
        return Icons.pending_outlined;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context).extension<OpenCodeTheme>()!;
    final isRunning =
        status != 'completed' && status != 'failed' && status != 'stopped';

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: _statusColor(theme).withValues(alpha: 0.3),
          width: 0.5,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Row(
          children: [
            Icon(
              _statusIcon(),
              size: 16,
              color: _statusColor(theme),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Background Task',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.textMuted,
                      letterSpacing: 0.3,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    summary,
                    style: TextStyle(
                      fontSize: 12,
                      color: theme.text,
                      height: 1.3,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (isRunning && onStop != null) ...[
              const SizedBox(width: 8),
              GestureDetector(
                onTap: onStop,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: theme.error.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(
                      color: theme.error.withValues(alpha: 0.3),
                      width: 0.5,
                    ),
                  ),
                  child: Text(
                    'Stop',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.error,
                    ),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
