import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
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
    final tool = interaction.origin?.toolName;
    final expires = interaction.expiresAt;
    final notes = [
      if (interaction.blocksRun) 'The run waits for this',
      if (tool != null) 'Asked by $tool',
      if (expires != null)
        'The backend gives up at '
            '${TimeOfDay.fromDateTime(DateTime.fromMillisecondsSinceEpoch(expires)).format(context)}',
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(interaction.title, style: AppTypography.h3(color: theme.text)),
        if (notes.isNotEmpty)
          Text(
            notes.join(' · '),
            style: AppTypography.caption(color: theme.textMuted),
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
}
