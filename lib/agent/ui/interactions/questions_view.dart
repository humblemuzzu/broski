import 'package:broski/agent/ui/interactions/reply_draft.dart';
import 'package:broski/contract/generated/contract.dart';
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
            Text(header, style: AppTypography.label(color: theme.primary)),
          Text(
            question.required ? '${question.text} *' : question.text,
            style: AppTypography.body(color: theme.text),
          ),
          for (final option in question.options)
            CheckboxListTile(
              key: ValueKey('question:${question.id}:${option.label}'),
              dense: true,
              controlAffinity: ListTileControlAffinity.leading,
              value: widget.pick.selected.contains(option.label),
              title: Text(option.label),
              subtitle: _details(option),
              onChanged: (_) => _toggle(option.label),
            ),
          if (question.allowCustom)
            TextField(
              key: ValueKey('question-custom:${question.id}'),
              controller: _custom,
              obscureText: question.secret,
              decoration: InputDecoration(
                labelText: question.options.isEmpty ? 'Answer' : 'Other',
              ),
              onChanged: _type,
            ),
        ],
      ),
    );
  }
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
