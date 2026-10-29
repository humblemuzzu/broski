import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/outgoing_prompt.dart';
import 'package:broski/agent/ui/chat/entry_views.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
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
    return UserBubble(
      text: prompt.input.text,
      footer: [
        Text(label, style: AppTypography.caption(color: color)),
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
    final desk = ref.read(sessionProvider(session).notifier).prompts;
    final id = prompt.clientRequestId;
    return Wrap(
      children: [
        TextButton(
          key: ValueKey('retry-prompt:$id'),
          onPressed: () => desk.retry(id),
          child: const Text('Send again'),
        ),
        TextButton(
          onPressed: () {
            final input = desk.withdraw(id);
            if (input != null) onEdit(input);
          },
          child: const Text('Edit'),
        ),
        TextButton(
          onPressed: () => desk.withdraw(id),
          child: const Text('Discard'),
        ),
      ],
    );
  }
}
