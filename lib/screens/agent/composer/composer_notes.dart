import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/composer/shell_command.dart';
import 'package:broski/screens/agent/shared/select_pill.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// While a run is on: whether what is sent goes into the running turn or
/// waits for it to end, as two chips like the input bar's own.
class ModeToggle extends StatelessWidget {
  const ModeToggle({
    super.key,
    required this.modes,
    required this.selected,
    required this.onChanged,
  });

  final List<PromptMode> modes;
  final PromptMode? selected;
  final ValueChanged<PromptMode> onChanged;

  @override
  Widget build(BuildContext context) => Padding(
    key: const ValueKey('composer-mode'),
    padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
    child: Row(
      children: [
        for (final mode in modes) ...[
          SelectPill(
            dense: true,
            label: modeLabel(mode),
            selected: mode == selected,
            onTap: () => onChanged(mode),
          ),
          const SizedBox(width: Spacing.sm),
        ],
      ],
    ),
  );
}

String modeLabel(PromptMode mode) => switch (mode) {
  PromptMode.start => 'Send',
  PromptMode.steer => 'Steer now',
  PromptMode.queue => 'Queue',
};

/// The command the prompt runs, with what it takes as arguments, and a way
/// to drop it.
class CommandNote extends StatelessWidget {
  const CommandNote({super.key, required this.command, required this.onClear});

  final CommandSummary command;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final hint = command.argumentHint;
    return Padding(
      key: const ValueKey('composer-command'),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
      child: Row(
        children: [
          Icon(AppIcons.terminal, size: 14, color: theme.primary),
          const SizedBox(width: 6),
          Text(
            '/${command.name}',
            style: TextStyle(
              color: theme.primary,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (hint != null) ...[
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                hint,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: theme.textMuted, fontSize: 11),
              ),
            ),
          ] else
            const Spacer(),
          GestureDetector(
            key: const ValueKey('composer-command-clear'),
            onTap: onClear,
            child: Icon(AppIcons.close, size: 14, color: theme.textMuted),
          ),
        ],
      ),
    );
  }
}

/// Says where a `!command` runs and where its output goes.
class ShellNote extends StatelessWidget {
  const ShellNote({super.key, required this.shell, required this.running});

  final ShellCommand shell;
  final bool running;

  @override
  Widget build(BuildContext context) => _Note(
    key: const ValueKey('composer-shell'),
    text: running
        ? 'Wait for the run to end to run this command.'
        : shell.excludeFromContext
        ? "Runs in a shell. The output stays out of the model's context."
        : "Runs in a shell. The output goes to the model's context.",
    color: OpenCodeTheme.of(context).primary,
  );
}

/// Said under the input bar while a run is on, when the backend takes no
/// input until it ends.
class NoInputNote extends StatelessWidget {
  const NoInputNote({super.key});

  @override
  Widget build(BuildContext context) => _Note(
    text: 'This backend takes no input while a run is on.',
    color: OpenCodeTheme.of(context).textMuted,
  );
}

class _Note extends StatelessWidget {
  const _Note({super.key, required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(20, 0, 20, 4),
    child: Align(
      alignment: Alignment.centerLeft,
      child: Text(text, style: TextStyle(color: color, fontSize: 11)),
    ),
  );
}
