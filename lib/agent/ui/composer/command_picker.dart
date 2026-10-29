import 'package:broski/agent/catalog/catalog_lists.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The backend's commands, skills and prompt templates for this session
/// (contract §11.4); the one picked is run with the text as its arguments.
Future<CommandSummary?> pickCommand(
  BuildContext context,
  SessionRef session,
  String? cwd,
) => DetailSheet.show<CommandSummary>(
  context: context,
  title: 'Commands',
  child: Consumer(
    builder: (context, ref, _) {
      final key = (backend: session.backend, cwd: cwd, session: session);
      return switch (ref.watch(commandsProvider(key)).valueOrNull) {
        null => const Padding(
          padding: Insets.screen,
          child: Center(
            child: CircularProgressIndicator(
              semanticsLabel: 'Loading the commands',
            ),
          ),
        ),
        Done(value: final commands) => Column(
          children: [
            for (final command in commands)
              ListTile(
                key: ValueKey('command:${command.id}'),
                title: Text(command.name),
                subtitle: Text(
                  [command.kind.wire, ?command.description].join(' · '),
                ),
                onTap: () => Navigator.of(context).pop(command),
              ),
            if (commands.isEmpty)
              const Padding(padding: Insets.screen, child: Text('No commands')),
          ],
        ),
        final failed => Padding(
          padding: Insets.screen,
          child: Text(problemOf(failed) ?? ''),
        ),
      };
    },
  ),
);
