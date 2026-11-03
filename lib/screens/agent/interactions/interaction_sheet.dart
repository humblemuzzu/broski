import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/answers/answer_check.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/answer_button.dart';
import 'package:broski/screens/agent/interactions/interaction_header.dart';
import 'package:broski/screens/agent/interactions/kind_view.dart';
import 'package:broski/screens/agent/interactions/reply_draft.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The one sheet every question a backend asks is answered in (contract §9).
/// It follows the live state: once the ask is answered elsewhere, withdrawn
/// or expired, the sheet says so and sends nothing.
Future<void> showInteractionSheet(
  BuildContext context,
  SessionRef session,
  InteractionId id,
) => DetailSheet.show<void>(
  context: context,
  title: 'Answer',
  initialSize: 0.75,
  maxSize: 0.95,
  child: Consumer(
    builder: (context, ref, _) {
      final asked = ref
          .watch(sessionProvider(session))
          .snapshot
          .interactions
          .where((interaction) => interaction.id == id)
          .firstOrNull;
      if (asked == null) return const _Withdrawn();
      return InteractionAnswerForm(session: session, interaction: asked);
    },
  ),
);

class _Withdrawn extends StatelessWidget {
  const _Withdrawn();

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.screen,
      child: Text(
        'This is no longer waiting for an answer.',
        style: AppTypography.body(color: theme.textMuted),
      ),
    );
  }
}

/// The question, the inputs its kind needs, the problem with the answer so
/// far as the contract's own check finds it, and the ways to answer or skip.
class InteractionAnswerForm extends ConsumerStatefulWidget {
  const InteractionAnswerForm({
    super.key,
    required this.session,
    required this.interaction,
  });

  final SessionRef session;
  final Interaction interaction;

  @override
  ConsumerState<InteractionAnswerForm> createState() =>
      _InteractionAnswerFormState();
}

class _InteractionAnswerFormState extends ConsumerState<InteractionAnswerForm> {
  ReplyDraft? _draft;
  String? _sendProblem;
  var _sending = false;

  String? get _problem => switch (_draft) {
    null => 'Answer to continue',
    DraftProblem(:final problem) => problem,
    DraftReply(:final reply) => answerProblem(
      widget.interaction,
      InteractionAnswer(interactionId: widget.interaction.id, reply: reply),
    ),
  };

  Future<void> _send(InteractionReply reply) async {
    if (_sending) return;
    setState(() => _sending = true);
    final controls = ref
        .read(sessionProvider(widget.session).notifier)
        .controls;
    final problem = await controls.answer(widget.interaction, reply);
    if (!mounted) return;
    setState(() {
      _sending = false;
      _sendProblem = problem;
    });
    if (problem == null) Navigator.of(context).maybePop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final problem = _sendProblem ?? _problem;
    final draft = _draft;
    return Padding(
      padding: Insets.screen,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InteractionHeader(interaction: widget.interaction),
          KindView(
            interaction: widget.interaction,
            onDraft: (next) => setState(() {
              _draft = next;
              _sendProblem = null;
            }),
            onSubmit: _send,
          ),
          if (problem != null && draft != null) _Problem(problem: problem),
          const SizedBox(height: Spacing.md),
          Divider(height: 1, color: theme.borderSubtle),
          const SizedBox(height: Spacing.md),
          Row(
            children: [
              _SkipMenu(onSkip: _send, enabled: !_sending),
              const Spacer(),
              if (submitsWithButton(widget.interaction.request))
                AnswerButton(
                  key: const ValueKey('answer-submit'),
                  label: _sending ? 'Sending…' : 'Send',
                  tone: AnswerTone.primary,
                  icon: AppIcons.send,
                  onTap: _sending || problem != null || draft is! DraftReply
                      ? null
                      : () => _send(draft.reply),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// What the contract's check finds wrong with the answer so far, in the
/// colour the prompts used for a refusal.
class _Problem extends StatelessWidget {
  const _Problem({required this.problem});

  final String problem;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      width: double.infinity,
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.error.withValues(alpha: 0.1),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.error.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(AppIcons.error, size: 14, color: theme.error),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Text(
              problem,
              key: const ValueKey('answer-problem'),
              style: AppTypography.bodySmall(color: theme.error),
            ),
          ),
        ],
      ),
    );
  }
}

/// Answers with `cancel` (contract §9): the human gives no answer, and says
/// whether the run goes on without it or stops.
class _SkipMenu extends StatelessWidget {
  const _SkipMenu({required this.onSkip, required this.enabled});

  final ValueChanged<InteractionReply> onSkip;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return PopupMenuButton<bool>(
      key: const ValueKey('answer-skip'),
      enabled: enabled,
      color: theme.backgroundPanel,
      onSelected: (stopRun) => onSkip(CancelReply(stopRun: stopRun)),
      itemBuilder: (context) => const [
        PopupMenuItem(value: false, child: Text('Skip, and let it go on')),
        PopupMenuItem(value: true, child: Text('Skip, and stop the run')),
      ],
      child: AnswerFace(
        label: 'Skip…',
        tone: AnswerTone.muted,
        icon: AppIcons.skip,
        enabled: enabled,
      ),
    );
  }
}
