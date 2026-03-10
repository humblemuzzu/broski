import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/service_providers.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';

Future<void> deleteOpenCodeMessageFromChat({
  required BuildContext context,
  required WidgetRef ref,
  required String sessionId,
  required String messageId,
  String? projectPath,
}) async {
  if (sessionId.isEmpty || messageId.isEmpty) return;

  final confirmed = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Delete message?'),
      content: const Text(
        'This permanently deletes the message and all its parts. '
        'File changes made by that message are not reverted.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Delete'),
        ),
      ],
    ),
  );

  if (confirmed != true || !context.mounted) return;

  try {
    final bridge = ref.read(bridgeServiceProvider);
    final ok = await bridge.ocDeleteMessage(
      sessionId: sessionId,
      messageId: messageId,
      projectPath: projectPath,
    );
    if (!context.mounted) return;

    final oc = OpenCodeTheme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok ? 'Message deleted' : 'Failed to delete message'),
        backgroundColor: ok
            ? oc.backgroundPanel
            : oc.error,
      ),
    );
  } catch (error) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Failed to delete message: ${humanizeError(error)}'),
        backgroundColor: OpenCodeTheme.of(context).error,
      ),
    );
  }
}
