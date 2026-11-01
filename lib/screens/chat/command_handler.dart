import 'package:broski/models/command.dart';
import 'package:broski/screens/sessions_screen.dart';
import 'package:flutter/material.dart';

/// Callbacks from [_ChatScreenState] that slash commands delegate to.
class CommandCallbacks {
  final VoidCallback showHelp;
  final VoidCallback copyTranscript;
  final VoidCallback exportTranscript;
  final VoidCallback showTimeline;
  final VoidCallback toggleThinking;
  final VoidCallback showModels;
  final VoidCallback showAgents;

  const CommandCallbacks({
    required this.showHelp,
    required this.copyTranscript,
    required this.exportTranscript,
    required this.showTimeline,
    required this.toggleThinking,
    required this.showModels,
    required this.showAgents,
  });
}

/// Handles slash command selection from the autocomplete menu.
///
/// The commands the app answers itself run here; every other one (Claude
/// Code's own `/compact` among them) is put in the input for the agent.
/// [onDismiss] hides the autocomplete; the caller calls `setState`.
void handleSlashCommand({
  required BuildContext context,
  required SlashCommand command,
  required TextEditingController controller,
  required CommandCallbacks callbacks,
  required VoidCallback onDismiss,
}) {
  if (command.builtin) {
    switch (command.name) {
      case 'new':
      case 'clear':
      case 'session':
      case 'resume':
      case 'continue':
        Navigator.of(
          context,
        ).push(MaterialPageRoute(builder: (_) => const SessionsScreen()));
        onDismiss();
        return;
      case 'help':
        callbacks.showHelp();
        onDismiss();
        return;
      case 'copy':
        callbacks.copyTranscript();
        onDismiss();
        return;
      case 'export':
        callbacks.exportTranscript();
        onDismiss();
        return;
      case 'timeline':
        callbacks.showTimeline();
        onDismiss();
        return;
      case 'thinking':
        callbacks.toggleThinking();
        onDismiss();
        return;
      case 'models':
        callbacks.showModels();
        onDismiss();
        return;
      case 'agents':
        callbacks.showAgents();
        onDismiss();
        return;
    }
  }

  controller.text = '/${command.name} ';
  controller.selection = TextSelection.fromPosition(
    TextPosition(offset: controller.text.length),
  );
  onDismiss();
}
