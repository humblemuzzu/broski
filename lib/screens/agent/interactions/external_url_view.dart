import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/answer_button.dart';
import 'package:broski/screens/agent/interactions/open_link.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A link to open, then go on (contract §9, `external_url`).
class ExternalUrlView extends StatelessWidget {
  const ExternalUrlView({
    super.key,
    required this.request,
    required this.onSubmit,
  });

  final ExternalUrlRequest request;
  final ValueChanged<InteractionReply> onSubmit;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (request.server case final server?)
          Padding(
            padding: Insets.bottomSm,
            child: Text(
              'From $server',
              style: AppTypography.caption(color: theme.textMuted),
            ),
          ),
        OpenLinkButton(url: request.url),
        const SizedBox(height: Spacing.md),
        AnswerButton(
          key: const ValueKey('external-done'),
          label: 'I have finished there',
          tone: AnswerTone.primary,
          icon: AppIcons.check,
          onTap: () => onSubmit(const ExternalUrlReply()),
        ),
      ],
    );
  }
}
