import 'package:broski/models/command.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/session.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/sessions_screen.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Callbacks from [_ChatScreenState] that slash commands delegate to.
class CommandCallbacks {
  final VoidCallback shareSession;
  final VoidCallback unshareSession;
  final VoidCallback showHelp;
  final VoidCallback showRename;
  final VoidCallback copyTranscript;
  final VoidCallback exportTranscript;
  final VoidCallback showTimeline;
  final VoidCallback showFork;
  final VoidCallback toggleThinking;
  final VoidCallback showModels;
  final VoidCallback showAgents;

  const CommandCallbacks({
    required this.shareSession,
    required this.unshareSession,
    required this.showHelp,
    required this.showRename,
    required this.copyTranscript,
    required this.exportTranscript,
    required this.showTimeline,
    required this.showFork,
    required this.toggleThinking,
    required this.showModels,
    required this.showAgents,
  });
}

/// Handles slash command selection from the autocomplete menu.
///
/// Extracted from `_ChatScreenState._selectCommand` in `chat_screen.dart`.
///
/// [onDismiss] is called after handling to hide the autocomplete and reset
/// the filter. The caller is responsible for calling `setState`.
Future<void> handleSlashCommand({
  required BuildContext context,
  required WidgetRef ref,
  required SlashCommand command,
  required SessionSummary session,
  required ProjectSummary project,
  required TextEditingController controller,
  required CommandCallbacks callbacks,
  required VoidCallback onDismiss,
}) async {
  final bridge = ref.read(bridgeServiceProvider);
  final chatState = ref.read(chatSessionProvider);
  final selectedModel = ref.read(selectionProvider).model;

  // Handle built-in commands
  if (command.builtin) {
    switch (command.name) {
      case 'undo':
        if (chatState.messages.isNotEmpty) {
          try {
            await bridge.revertMessage(
              session.id,
              messageId: chatState.messages.last.id,
              projectPath: project.path,
            );
            if (context.mounted) {
              showInfo(context, 'Message undone');
            }
          } catch (e) {
            if (context.mounted) {
              showInfo(context, 'Failed to undo: ${humanizeError(e)}');
            }
          }
        } else {
          if (context.mounted) {
            showInfo(context, 'No messages to undo');
          }
        }
        break;
      case 'redo':
        try {
          await bridge.unrevertSession(session.id, projectPath: project.path);
          if (context.mounted) {
            showInfo(context, 'Message redone');
          }
        } catch (e) {
          if (context.mounted) {
            showInfo(context, 'Failed to redo: ${humanizeError(e)}');
          }
        }
        break;
      case 'compact':
      case 'summarize':
        if (selectedModel != null) {
          try {
            final success = await bridge.summarizeSession(
              session.id,
              providerID: selectedModel.providerID,
              modelID: selectedModel.modelID,
              projectPath: project.path,
            );
            if (context.mounted) {
              if (success) {
                showSuccess(context, 'Session compacted');
              } else {
                showError(context, 'Failed to compact session');
              }
            }
          } catch (e) {
            if (context.mounted) {
              showInfo(context, 'Failed to compact: ${humanizeError(e)}');
            }
          }
        } else {
          if (context.mounted) {
            showInfo(context, 'Model not configured');
          }
        }
        break;
      case 'share':
        callbacks.shareSession();
        break;
      case 'unshare':
        callbacks.unshareSession();
        break;
      case 'new':
      case 'clear':
        if (context.mounted) {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const SessionsScreen()));
        }
        break;
      case 'session':
      case 'resume':
      case 'continue':
        if (context.mounted) {
          Navigator.of(
            context,
          ).push(MaterialPageRoute(builder: (_) => const SessionsScreen()));
        }
        break;
      case 'help':
        callbacks.showHelp();
        break;
      case 'rename':
        callbacks.showRename();
        break;
      case 'copy':
        callbacks.copyTranscript();
        break;
      case 'export':
        callbacks.exportTranscript();
        break;
      case 'timeline':
        callbacks.showTimeline();
        break;
      case 'fork':
        callbacks.showFork();
        break;
      case 'thinking':
        callbacks.toggleThinking();
        break;
      case 'models':
        callbacks.showModels();
        break;
      case 'agents':
        callbacks.showAgents();
        break;
      default:
        controller.text = '/${command.name} ';
        controller.selection = TextSelection.fromPosition(
          TextPosition(offset: controller.text.length),
        );
        break;
    }
    onDismiss();
    return;
  }

  // Handle custom commands (insert text for user to edit)
  controller.text = '/${command.name} ';
  controller.selection = TextSelection.fromPosition(
    TextPosition(offset: controller.text.length),
  );
  onDismiss();
}
