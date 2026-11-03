import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/ask_icon.dart';
import 'package:broski/screens/agent/interactions/meta_chip.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/adaptive_markdown_body.dart'
    show AdaptiveMarkdownBody;
import 'package:flutter/material.dart';

/// What is asked, by which tool, and the backend's own deadline when it has
/// one: shown, never acted on (contract §9: nothing answers for a human).
class InteractionHeader extends StatelessWidget {
  const InteractionHeader({super.key, required this.interaction});

  final Interaction interaction;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final look = askLook(interaction.request, theme);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            AskIcon(icon: look.icon, color: look.color),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    interaction.title,
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (_facts(context, theme) case final facts
                      when facts.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: Spacing.sm),
                      child: Wrap(
                        spacing: Spacing.xs,
                        runSpacing: Spacing.xs,
                        children: facts,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
        if (interaction.body case final body?)
          Padding(
            padding: Insets.topSm,
            child: AdaptiveMarkdownBody(data: body, selectable: true),
          ),
        const SizedBox(height: Spacing.md),
      ],
    );
  }

  List<Widget> _facts(BuildContext context, OpenCodeTheme theme) {
    final tool = interaction.origin?.toolName;
    final expires = interaction.expiresAt;
    return [
      if (interaction.blocksRun)
        MetaChip(
          label: 'The run waits for this',
          color: theme.warning,
          icon: AppIcons.warning,
        ),
      if (tool != null)
        MetaChip(
          label: 'Asked by $tool',
          color: theme.info,
          icon: AppIcons.tools,
        ),
      if (expires != null)
        MetaChip(
          label:
              'The backend gives up at '
              '${TimeOfDay.fromDateTime(DateTime.fromMillisecondsSinceEpoch(expires)).format(context)}',
          color: theme.textMuted,
          icon: AppIcons.schedule,
        ),
    ];
  }
}
