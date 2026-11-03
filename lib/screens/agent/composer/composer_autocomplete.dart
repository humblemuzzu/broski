import 'package:broski/agent/catalog/catalog_lists.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/command.dart';
import 'package:broski/widgets/chat/command_autocomplete.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What follows a `/` typed as the whole input so far, lowercased; null when
/// the input is not a command being typed.
String? slashFilter(String text) => text.startsWith('/') && !text.contains(' ')
    ? text.substring(1).toLowerCase()
    : null;

/// What follows the last `@` at the end of the input; null when the input
/// does not end in a mention being typed.
String? mentionQuery(String text) =>
    RegExp(r'@(\S*)$').firstMatch(text)?.group(1);

/// [text] without the mention being typed at its end.
String withoutMentionQuery(String text) =>
    text.replaceFirst(RegExp(r'@\S*$'), '');

/// The backend's commands whose name holds [filter], in the chat's slash
/// command popup; nothing while they load or when none matches.
class SlashCommandsPopup extends ConsumerWidget {
  const SlashCommandsPopup({
    super.key,
    required this.session,
    required this.cwd,
    required this.filter,
    required this.onPick,
  });

  final SessionRef session;
  final String? cwd;
  final String filter;
  final ValueChanged<CommandSummary> onPick;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final key = (backend: session.backend, cwd: cwd, session: session);
    final listed = ref.watch(commandsProvider(key)).valueOrNull;
    final commands = switch (listed) {
      Done(value: final all) => [
        for (final command in all)
          if (command.name.toLowerCase().contains(filter)) command,
      ],
      _ => const <CommandSummary>[],
    };
    if (commands.isEmpty) return const SizedBox.shrink();
    return Padding(
      key: const ValueKey('slash-commands'),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: CommandAutocomplete(
        commands: [
          for (final command in commands)
            SlashCommand(name: command.name, description: command.description),
        ],
        onSelect: (picked) => onPick(
          commands.firstWhere((command) => command.name == picked.name),
        ),
      ),
    );
  }
}
