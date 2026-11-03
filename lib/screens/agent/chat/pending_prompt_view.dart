import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart';
import 'package:broski/screens/agent/chat/message_views.dart';
import 'package:broski/screens/agent/shared/tinted_button.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/message_bubble.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A prompt shown before the session echoes it, with where it stands; one
/// that was not sent, or not confirmed, offers to send it again, edit it, or
/// drop it.
class PendingPromptView extends StatelessWidget {
  const PendingPromptView({
    super.key,
    required this.session,
    required this.prompt,
    required this.onEdit,
  });

  final SessionRef session;
  final OutgoingPrompt prompt;
  final ValueChanged<PromptInput> onEdit;

  @override
  Widget build(BuildContext context) {
    final (label, color) = _standing(
      prompt.delivery,
      OpenCodeTheme.of(context),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        MessageBubble(
          message: chatMessage(
            id: prompt.clientRequestId,
            role: MessageRole.user,
            text: prompt.input.text,
            delivery: prompt.delivery is PromptSending ? 'pending' : null,
          ),
        ),
        Text(label, style: TextStyle(color: color, fontSize: 11)),
        if (prompt.waitsForPerson)
          _PromptActions(session: session, prompt: prompt, onEdit: onEdit),
      ],
    );
  }
}

(String, Color) _standing(PromptDelivery delivery, OpenCodeTheme theme) =>
    switch (delivery) {
      PromptSending() => ('Sending…', theme.textMuted),
      PromptTaken(:final accepted) => (
        switch (accepted.disposition) {
          PromptDisposition.queued => 'Queued',
          PromptDisposition.steered => 'Sent to the running turn',
          PromptDisposition.started || PromptDisposition.handled => 'Sent',
        },
        theme.textMuted,
      ),
      PromptUnconfirmed(:final reason, resending: true) => (
        'Not confirmed: $reason · sending again',
        theme.warning,
      ),
      PromptUnconfirmed(:final reason, resending: false) => (
        'Not confirmed: $reason',
        theme.warning,
      ),
      PromptNotSent(:final reason) => ('Not sent: $reason', theme.error),
    };

class _PromptActions extends ConsumerWidget {
  const _PromptActions({
    required this.session,
    required this.prompt,
    required this.onEdit,
  });

  final SessionRef session;
  final OutgoingPrompt prompt;
  final ValueChanged<PromptInput> onEdit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final desk = ref.read(sessionProvider(session).notifier).prompts;
    final id = prompt.clientRequestId;
    return Padding(
      padding: const EdgeInsets.only(top: Spacing.xs, bottom: Spacing.sm),
      child: Wrap(
        spacing: Spacing.sm,
        children: [
          TintedButton(
            key: ValueKey('retry-prompt:$id'),
            label: 'Send again',
            color: theme.primary,
            onTap: () => desk.retry(id),
          ),
          TintedButton(
            label: 'Edit',
            color: theme.textMuted,
            onTap: () {
              final input = desk.withdraw(id);
              if (input != null) onEdit(input);
            },
          ),
          TintedButton(
            label: 'Discard',
            color: theme.error,
            onTap: () => desk.withdraw(id),
          ),
        ],
      ),
    );
  }
}
