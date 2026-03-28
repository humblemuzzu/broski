import 'package:broski/providers/service_providers.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows a dialog to run a shell command in the context of the current
/// OpenCode session. The agent sees the output and can respond to it.
Future<void> showOcShellCommandDialog(
  BuildContext context,
  WidgetRef ref, {
  required String sessionId,
  String? projectPath,
}) async {
  if (sessionId.isEmpty) return;

  final commandController = TextEditingController();

  final result = await showDialog<Map<String, String?>?>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Run Shell Command'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: commandController,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              hintText: '\$ npm test',
              labelText: 'Command',
              prefixText: '\$ ',
            ),
            autofocus: true,
            onSubmitted: (value) {
              if (value.trim().isNotEmpty) {
                Navigator.pop(ctx, {'command': value.trim()});
              }
            },
          ),
          const SizedBox(height: 12),
          Text(
            'This runs the command in the context of the current session. '
            'The agent will see the output and can respond to it.',
            style: Theme.of(
              ctx,
            ).textTheme.bodySmall?.copyWith(color: Colors.grey),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(ctx, null),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () {
            final cmd = commandController.text.trim();
            if (cmd.isEmpty) return;
            Navigator.pop(ctx, {'command': cmd});
          },
          child: const Text('▶ Run'),
        ),
      ],
    ),
  );
  commandController.dispose();

  if (result == null || !context.mounted) return;

  final command = result['command'];
  if (command == null || command.isEmpty) return;

  try {
    final bridge = ref.read(bridgeServiceProvider);
    await bridge.ocSessionShell(
      sessionId: sessionId,
      command: command,
      projectPath: projectPath,
    );
    if (!context.mounted) return;

    showSuccess(context, 'Running: $command');
  } catch (error) {
    if (!context.mounted) return;
    showError(context, 'Shell command failed: ${humanizeError(error)}');
  }
}
