import 'package:broski/agent/catalog/catalog_lists.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
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
              _CommandRow(
                key: ValueKey('command:${command.id}'),
                command: command,
                onTap: () => Navigator.of(context).pop(command),
              ),
            if (commands.isEmpty)
              Padding(
                padding: Insets.screen,
                child: Text(
                  'No commands',
                  style: AppTypography.bodySmall(
                    color: OpenCodeTheme.of(context).textMuted,
                  ),
                ),
              ),
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

/// One command as the chat's commands sheet lists it.
class _CommandRow extends StatelessWidget {
  const _CommandRow({super.key, required this.command, required this.onTap});

  final CommandSummary command;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: Icon(AppIcons.chevronRight, color: theme.textMuted, size: 18),
      title: Text(
        '/${command.name}',
        style: AppTypography.bodySmall(color: theme.text),
      ),
      subtitle: Text(
        [command.kind.wire, ?command.description].join(' · '),
        style: AppTypography.caption(color: theme.textMuted),
      ),
      onTap: onTap,
    );
  }
}
