import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/ui/interactions/interaction_sheet.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Every question the session waits on, with how this phone's answer to it
/// stands. A session whose asks this phone cannot answer shows them without
/// an answer button: the client that owns it answers (core README §18). A
/// watch-only session may still take answers (core README §21).
class InteractionBar extends ConsumerWidget {
  const InteractionBar({super.key, required this.session, required this.state});

  final SessionRef session;
  final AgentSessionState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asked = state.snapshot.interactions;
    if (asked.isEmpty) return const SizedBox.shrink();
    final theme = OpenCodeTheme.of(context);
    final controls = ref.read(sessionProvider(session).notifier).controls;
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final interaction in asked)
          ListTile(
            key: ValueKey('interaction:${interaction.id}'),
            dense: true,
            contentPadding: Insets.cardH,
            leading: Icon(
              AppIcons.help,
              color: interaction.blocksRun ? theme.warning : theme.info,
            ),
            title: Text(interaction.title, style: AppTypography.body()),
            subtitle: switch (state.answering[interaction.id]) {
              null => null,
              AnswerSending() => const Text('Answer sent'),
              AnswerNotTaken(:final reason) => Text(
                reason,
                style: AppTypography.bodySmall(color: theme.error),
              ),
            },
            trailing: state.answerable
                ? TextButton(
                    onPressed: () {
                      if (state.answering[interaction.id] is AnswerNotTaken) {
                        controls.dismissAnswerProblem(interaction.id);
                      }
                      showInteractionSheet(context, session, interaction.id);
                    },
                    child: const Text('Answer'),
                  )
                : null,
          ),
      ],
    );
  }
}
