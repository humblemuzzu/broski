import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/chat_provider.dart';
import '../../providers/selection_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/haptics_service.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Compacts (summarizes) the current OpenCode session.
/// Extracted from `_ChatScreenState._compactSession` in `chat_screen.dart`.
Future<void> compactSession({
  required BuildContext context,
  required WidgetRef ref,
  required String sessionId,
  required String projectPath,
  required HapticsService haptics,
  required VoidCallback onRefreshContext,
}) async {
  final theme = OpenCodeTheme.of(context);
  final selectedModel = ref.read(selectionProvider).model;
  if (selectedModel == null) {
    showError(context, 'Please select a model first');
    return;
  }
  // Confirm compact
  final confirm = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: theme.backgroundPanel,
      title: Text('Compact Session?', style: TextStyle(color: theme.text)),
      content: Text(
        'This will summarize older messages to free up context window space. This cannot be undone.',
        style: TextStyle(color: theme.textMuted),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text('Compact', style: TextStyle(color: theme.primary)),
        ),
      ],
    ),
  );
  if (confirm != true) return;
  haptics.mediumImpact();
  ref.read(chatSessionProvider.notifier).setCompacting(true);
  try {
    final bridge = ref.read(bridgeServiceProvider);
    final success = await bridge.summarizeSession(
      sessionId,
      providerID: selectedModel.providerID,
      modelID: selectedModel.modelID,
      projectPath: projectPath,
    );
    if (!context.mounted) return;
    if (success) {
      showSuccess(context, 'Session compacted successfully');
      // Refresh context to show updated token count
      onRefreshContext();
    } else {
      ref.read(chatSessionProvider.notifier).setCompacting(false);
      showError(context, 'Failed to compact session');
    }
  } catch (e) {
    if (!context.mounted) return;
    ref.read(chatSessionProvider.notifier).setCompacting(false);
    showError(context, 'Failed to compact: ${humanizeError(e)}');
  }
}
