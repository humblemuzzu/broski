import 'package:broski/agent/agent_providers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/cc_queue_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Input the backend holds for later (`queue_changed`), each in the chat's
/// queued-message bar, removable where the session allows it
/// (`cancelQueued`).
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
    final theme = OpenCodeTheme.of(context);
    final controls = ref.read(sessionProvider(session).notifier).controls;
    return Column(
      key: const ValueKey('queue-strip'),
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final item in queue)
          CCQueueBar(
            key: ValueKey('queue-item:${item.id}'),
            pendingMessage: item.preview,
            label: item.delivery == QueuedDelivery.steer
                ? 'Next \u2014 goes into the running turn'
                : 'Queued \u2014 will send when turn completes',
            onCancel: cancellable ? () => controls.cancelQueued(item.id) : null,
            primaryColor: theme.primary,
            textColor: theme.text,
            mutedColor: theme.textMuted,
            surfaceColor: theme.backgroundPanel,
          ),
      ],
    );
  }
}
