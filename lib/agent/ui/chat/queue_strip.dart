import 'package:broski/agent/agent_providers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Input the backend holds for later (`queue_changed`), each item removable
/// where the session allows it (`cancelQueued`).
class QueueStrip extends ConsumerWidget {
  const QueueStrip({
    super.key,
    required this.session,
    required this.queue,
    required this.cancellable,
  });

  final SessionRef session;
  final List<QueueItem> queue;
  final bool cancellable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controls = ref.read(sessionProvider(session).notifier).controls;
    return Padding(
      key: const ValueKey('queue-strip'),
      padding: Insets.chipH,
      child: Wrap(
        spacing: Spacing.xs,
        children: [
          for (final item in queue)
            InputChip(
              key: ValueKey('queue-item:${item.id}'),
              label: Text(
                '${item.delivery == QueuedDelivery.steer ? 'Next' : 'Later'}: '
                '${item.preview}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              onDeleted: cancellable
                  ? () => controls.cancelQueued(item.id)
                  : null,
            ),
        ],
      ),
    );
  }
}
