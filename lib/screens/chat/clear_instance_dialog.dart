import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/service_providers.dart';
import '../../theme/opencode_theme.dart';

/// Shows a confirmation dialog to clear the OpenCode instance.
/// Extracted from `_ChatScreenState._clearInstance`.
Future<void> showClearInstanceDialog({
  required BuildContext context,
  required WidgetRef ref,
  required String projectPath,
}) async {
  final theme = OpenCodeTheme.of(context);
  final confirm = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: theme.backgroundPanel,
      title: Text('Clear Instance?', style: TextStyle(color: theme.text)),
      content: Text(
        'This will reset the project context on OpenCode server. '
        'Caches and loaded files will be cleared.\n\n'
        'Your chat history will remain.',
        style: TextStyle(color: theme.textMuted),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text('Clear', style: TextStyle(color: theme.warning)),
        ),
      ],
    ),
  );
  if (confirm != true || !context.mounted) return;
  final bridge = ref.read(bridgeServiceProvider);
  final success = await bridge.disposeInstance(projectPath: projectPath);
  if (!context.mounted) return;
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      content: Text(success ? 'Instance cleared' : 'Failed to clear instance'),
      backgroundColor: theme.backgroundPanel,
    ),
  );
}
