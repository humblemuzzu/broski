import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/interaction_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Every question the session waits on, with how this phone's answer to it
/// stands. A new one opens its sheet by itself, once, as the chat's prompts
/// always did; it is only ever answered by the person. A session whose asks
/// this phone cannot answer shows them without an answer button: the client
/// that owns it answers (core README §18). A watch-only session may still
/// take answers (core README §21).
class InteractionBar extends ConsumerStatefulWidget {
  const InteractionBar({super.key, required this.session, required this.state});

  final SessionRef session;
  final AgentSessionState state;

  @override
  ConsumerState<InteractionBar> createState() => _InteractionBarState();
}

class _InteractionBarState extends ConsumerState<InteractionBar> {
  final _opened = <InteractionId>{};
  var _sheetUp = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _openNew());
  }

  @override
  void didUpdateWidget(InteractionBar old) {
    super.didUpdateWidget(old);
    if (!identical(old.state.snapshot.interactions, _asked) ||
        old.state.answerable != widget.state.answerable) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _openNew());
    }
  }

  List<Interaction> get _asked => widget.state.snapshot.interactions;

  /// Opens the oldest ask not opened yet, one sheet at a time: the next
  /// opens when the one up closes.
  void _openNew() {
    if (!mounted || _sheetUp || !widget.state.answerable) return;
    final next = _asked.where((asked) => !_opened.contains(asked.id));
    final first = next.firstOrNull;
    if (first == null) return;
    _opened.add(first.id);
    _open(first.id);
  }

  Future<void> _open(InteractionId id) async {
    final controls = ref
        .read(sessionProvider(widget.session).notifier)
        .controls;
    if (widget.state.answering[id] is AnswerNotTaken) {
      controls.dismissAnswerProblem(id);
    }
    _sheetUp = true;
    await showInteractionSheet(context, widget.session, id);
    _sheetUp = false;
    _openNew();
  }

  @override
  Widget build(BuildContext context) {
    if (_asked.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final interaction in _asked)
            _AskCard(
              key: ValueKey('interaction:${interaction.id}'),
              interaction: interaction,
              progress: widget.state.answering[interaction.id],
              onAnswer: widget.state.answerable
                  ? () => _open(interaction.id)
                  : null,
            ),
        ],
      ),
    );
  }
}

class _AskCard extends StatelessWidget {
  const _AskCard({
    super.key,
    required this.interaction,
    required this.progress,
    required this.onAnswer,
  });

  final Interaction interaction;
  final AnswerProgress? progress;
  final VoidCallback? onAnswer;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final color = interaction.blocksRun ? theme.warning : theme.info;
    return Container(
      margin: const EdgeInsets.only(bottom: Spacing.xs),
      padding: const EdgeInsets.fromLTRB(14, 10, 10, 10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: Radii.brMd,
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(AppIcons.help, color: color, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: _AskText(interaction: interaction, progress: progress),
          ),
          if (onAnswer case final answer?)
            GestureDetector(
              key: ValueKey('interaction-answer:${interaction.id}'),
              onTap: answer,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: Radii.brSm,
                ),
                child: Text(
                  'Answer',
                  style: TextStyle(
                    color: theme.background,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _AskText extends StatelessWidget {
  const _AskText({required this.interaction, required this.progress});

  final Interaction interaction;
  final AnswerProgress? progress;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final note = switch (progress) {
      null => null,
      AnswerSending() => ('Answer sent', theme.textMuted),
      AnswerNotTaken(:final reason) => (reason, theme.error),
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          interaction.title,
          style: TextStyle(
            color: theme.text,
            fontSize: 13,
            fontWeight: FontWeight.w500,
          ),
        ),
        if (note case (final text, final color))
          Text(text, style: TextStyle(color: color, fontSize: 11)),
      ],
    );
  }
}
