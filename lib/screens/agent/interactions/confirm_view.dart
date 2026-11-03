import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/answer_button.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';

/// A yes or no (contract §9, `confirm`): the prompt's quiet no on the left,
/// its filled yes on the right, both answering as they are tapped.
class ConfirmView extends StatelessWidget {
  const ConfirmView({super.key, required this.onSubmit});

  final ValueChanged<InteractionReply> onSubmit;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: AnswerButton(
          key: const ValueKey('confirm-no'),
          label: 'No',
          tone: AnswerTone.muted,
          onTap: () => onSubmit(const ConfirmReply(confirmed: false)),
        ),
      ),
      const SizedBox(width: Spacing.sm),
      Expanded(
        child: AnswerButton(
          key: const ValueKey('confirm-yes'),
          label: 'Yes',
          tone: AnswerTone.primary,
          onTap: () => onSubmit(const ConfirmReply(confirmed: true)),
        ),
      ),
    ],
  );
}
