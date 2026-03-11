import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/pi_provider.dart';
import '../../services/pi_bridge_service.dart';

/// Compact queue indicator shown above chat input when Pi has pending messages.
/// Shows counts of steering/follow-up messages with a clear button.
class PiQueueIndicator extends ConsumerWidget {
  const PiQueueIndicator({
    super.key,
    required this.projectPath,
    required this.pendingCount,
  });

  final String? projectPath;
  final int pendingCount;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (pendingCount <= 0) return const SizedBox.shrink();

    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      margin: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: colorScheme.surfaceContainerHighest.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: colorScheme.outlineVariant.withValues(alpha: 0.5),
        ),
      ),
      child: Row(
        children: [
          Icon(
            Icons.queue_outlined,
            size: 16,
            color: colorScheme.primary,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              '$pendingCount queued',
              style: theme.textTheme.bodySmall?.copyWith(
                color: colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          InkWell(
            borderRadius: BorderRadius.circular(4),
            onTap: () => _clearQueue(context, ref),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Clear',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: colorScheme.primary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(width: 2),
                  Icon(
                    Icons.close,
                    size: 14,
                    color: colorScheme.primary,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _clearQueue(BuildContext context, WidgetRef ref) async {
    try {
      final bridge = ref.read(piBridgeServiceProvider);
      await bridge.clearQueue(projectPath: projectPath);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to clear queue: $e')),
        );
      }
    }
  }
}
