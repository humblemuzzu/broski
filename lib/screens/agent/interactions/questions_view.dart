import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/ask_field.dart';
import 'package:broski/screens/agent/interactions/option_card.dart';
import 'package:broski/screens/agent/interactions/reply_draft.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/adaptive_markdown_body.dart'
    show AdaptiveMarkdownBody;
import 'package:flutter/material.dart';

/// One or more questions (contract §9, `questions`): options to pick, one or
/// several, free text where allowed, hidden as typed when secret.
class QuestionsView extends StatefulWidget {
  const QuestionsView({
    super.key,
    required this.request,
    required this.onDraft,
  });

  final QuestionsRequest request;
  final ValueChanged<ReplyDraft> onDraft;

  @override
  State<QuestionsView> createState() => _QuestionsViewState();
}

class _QuestionsViewState extends State<QuestionsView> {
  final Map<String, QuestionPick> _picks = {};

  void _set(Question question, QuestionPick pick) {
    setState(() => _picks[question.id] = pick);
    widget.onDraft(questionsDraft(widget.request, _picks));
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final question in widget.request.questions)
        _QuestionInput(
          question: question,
          pick: _picks[question.id] ?? const QuestionPick(),
          onChanged: (pick) => _set(question, pick),
        ),
    ],
  );
}

/// A single-choice question takes one answer: picking an option clears the
/// free text, and typing free text clears the option.
class _QuestionInput extends StatefulWidget {
  const _QuestionInput({
    required this.question,
    required this.pick,
    required this.onChanged,
  });

  final Question question;
  final QuestionPick pick;
  final ValueChanged<QuestionPick> onChanged;

  @override
  State<_QuestionInput> createState() => _QuestionInputState();
}

class _QuestionInputState extends State<_QuestionInput> {
  final _custom = TextEditingController();

  @override
  void dispose() {
    _custom.dispose();
    super.dispose();
  }

  void _toggle(String label) {
    final question = widget.question;
    final selected = widget.pick.selected;
    if (!question.multiSelect) _custom.clear();
    widget.onChanged(
      QuestionPick(
        selected: !question.multiSelect
            ? {label}
            : selected.contains(label)
            ? ({...selected}..remove(label))
            : {...selected, label},
        custom: _custom.text,
      ),
    );
  }

  void _type(String text) => widget.onChanged(
    QuestionPick(
      selected: widget.question.multiSelect || text.isEmpty
          ? widget.pick.selected
          : const {},
      custom: text,
    ),
  );

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final question = widget.question;
    return Padding(
      padding: Insets.bottomMd,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (question.header case final header?)
            Padding(
              padding: Insets.bottomSm,
              child: Text(
                header,
                style: AppTypography.label(color: theme.primary),
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(bottom: Spacing.md),
            child: Text(
              question.required ? '${question.text} *' : question.text,
              style: TextStyle(
                color: theme.text,
                fontSize: 14,
                fontWeight: FontWeight.w500,
                height: 1.4,
              ),
            ),
          ),
          for (final option in question.options)
            OptionCard(
              key: ValueKey('question:${question.id}:${option.label}'),
              label: option.label,
              detail: _details(option),
              multi: question.multiSelect,
              selected: widget.pick.selected.contains(option.label),
              onTap: () => _toggle(option.label),
            ),
          if (question.allowCustom) _customField(theme, question),
        ],
      ),
    );
  }

  Widget _customField(OpenCodeTheme theme, Question question) => Padding(
    padding: Insets.topSm,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AskFieldLabel(text: question.options.isEmpty ? 'Answer' : 'Other'),
        TextField(
          key: ValueKey('question-custom:${question.id}'),
          controller: _custom,
          obscureText: question.secret,
          style: AppTypography.body(color: theme.text),
          decoration: askInput(theme, hint: 'Type your answer…'),
          onChanged: _type,
        ),
      ],
    ),
  );
}

Widget? _details(QuestionOption option) {
  final description = option.description;
  final preview = option.preview;
  if (description == null && preview == null) return null;
  return Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      if (description != null) Text(description),
      if (preview != null) AdaptiveMarkdownBody(data: preview),
    ],
  );
}
