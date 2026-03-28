import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/haptics_service.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Initializes a project by creating AGENTS.md.
/// Extracted from `_ChatScreenState._initializeProject` in `chat_screen.dart`.
Future<void> initializeProject({
  required BuildContext context,
  required WidgetRef ref,
  required String sessionId,
  required String projectPath,
  required HapticsService haptics,
}) async {
  final theme = OpenCodeTheme.of(context);
  final selectedModel = ref.read(selectionProvider).model;
  if (selectedModel == null) {
    showError(context, 'Please select a model first');
    return;
  }
  // Confirm initialization
  final confirm = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: theme.backgroundPanel,
      title: Text('Initialize Project?', style: TextStyle(color: theme.text)),
      content: Text(
        'This will analyze your project and create an AGENTS.md file with project-specific instructions for the AI.',
        style: TextStyle(color: theme.textMuted),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text('Initialize', style: TextStyle(color: theme.success)),
        ),
      ],
    ),
  );
  if (confirm != true) return;
  haptics.mediumImpact();
  if (!context.mounted) return;
  // Show a loading message
  showInfo(context, 'Initializing project...');
  try {
    final bridge = ref.read(bridgeServiceProvider);
    // Get the latest message ID (used for init)
    final chatState = ref.read(chatSessionProvider);
    final messageId = chatState.messages.isNotEmpty
        ? chatState.messages.last.id
        : 'init';
    final success = await bridge.initSession(
      sessionId: sessionId,
      providerID: selectedModel.providerID,
      modelID: selectedModel.modelID,
      messageID: messageId,
      projectPath: projectPath,
    );
    if (!context.mounted) return;
    if (success) {
      showSuccess(context, 'Project initialized! AGENTS.md created.');
    } else {
      showError(context, 'Failed to initialize project');
    }
  } catch (e) {
    if (!context.mounted) return;
    showError(context, 'Failed to initialize: ${humanizeError(e)}');
  }
}
