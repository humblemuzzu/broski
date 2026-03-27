import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/command.dart';
import '../../models/project.dart';
import '../../models/session.dart';
import '../../providers/chat_provider.dart';
import '../../providers/selection_provider.dart';
import '../../providers/service_providers.dart';
import '../../utils/error_utils.dart';
import '../sessions_screen.dart';

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
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(const SnackBar(content: Text('Message undone')));
            }
          } catch (e) {
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Failed to undo: ${humanizeError(e)}')),
              );
            }
          }
        } else {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('No messages to undo')),
            );
          }
        }
        break;
      case 'redo':
        try {
          await bridge.unrevertSession(session.id, projectPath: project.path);
          if (context.mounted) {
            ScaffoldMessenger.of(
              context,
            ).showSnackBar(const SnackBar(content: Text('Message redone')));
          }
        } catch (e) {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Failed to redo: ${humanizeError(e)}')),
            );
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
              ScaffoldMessenger.of(context).showSnackBar(
                success
                    ? const SnackBar(content: Text('Session compacted'))
                    : const SnackBar(
                        content: Text('Failed to compact session'),
                      ),
              );
            }
          } catch (e) {
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Failed to compact: ${humanizeError(e)}'),
                ),
              );
            }
          }
        } else {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Model not configured')),
            );
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
