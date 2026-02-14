import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../theme/opencode_theme.dart';

/// Compact inline card for Claude Code hook lifecycle events.
/// Shows hook name, event type, and execution status.
class CompactHookCard extends ConsumerWidget {
  final String hookName;
  final String hookEvent;
  final String status; // 'running' | 'success' | 'error' | 'cancelled'
  final String? output;

  const CompactHookCard({
    super.key,
    required this.hookName,
    required this.hookEvent,
    required this.status,
    this.output,
  });

  Color _statusColor(OpenCodeTheme theme) {
    switch (status) {
      case 'success':
        return theme.success;
      case 'error':
        return theme.error;
      case 'cancelled':
        return theme.textMuted;
      default:
        return theme.accent;
    }
  }

  IconData _statusIcon() {
    switch (status) {
      case 'success':
        return Icons.check_circle_outline_rounded;
      case 'error':
        return Icons.error_outline_rounded;
      case 'cancelled':
        return Icons.cancel_outlined;
      default:
        return Icons.bolt_rounded;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context).extension<OpenCodeTheme>()!;

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 2),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: _statusColor(theme).withValues(alpha: 0.2),
          width: 0.5,
        ),
      ),
      child: Row(
        children: [
          Icon(
            _statusIcon(),
            size: 14,
            color: _statusColor(theme),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: 'Hook: ',
                    style: TextStyle(
                      fontSize: 11,
                      color: theme.textMuted,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  TextSpan(
                    text: hookName,
                    style: TextStyle(
                      fontSize: 11,
                      color: theme.textMuted,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  TextSpan(
                    text: ' · $hookEvent',
                    style: TextStyle(
                      fontSize: 11,
                      color: theme.textMuted,
                    ),
                  ),
                ],
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (status == 'running') ...[
            const SizedBox(width: 8),
            SizedBox(
              width: 12,
              height: 12,
              child: CircularProgressIndicator(
                strokeWidth: 1.5,
                color: theme.accent,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
