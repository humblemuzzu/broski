import 'package:broski/agent/ui/interactions/open_link.dart';
import 'package:broski/agent/ui/interactions/reply_draft.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/adaptive_markdown_body.dart'
    show AdaptiveMarkdownBody;
import 'package:flutter/material.dart';

/// A plan to approve (contract §9, `plan_approval`): approve it, edited when
/// the backend allows, or reject it with feedback.
class PlanView extends StatefulWidget {
  const PlanView({super.key, required this.request, required this.onDraft});

  final PlanApprovalRequest request;
  final ValueChanged<ReplyDraft> onDraft;

  @override
  State<PlanView> createState() => _PlanViewState();
}

class _PlanViewState extends State<PlanView> {
  var _decision = PlanDecision.approve;
  var _editing = false;
  late final _plan = TextEditingController(text: widget.request.plan);
  final _feedback = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _report());
  }

  @override
  void dispose() {
    _plan.dispose();
    _feedback.dispose();
    super.dispose();
  }

  void _report() {
    if (!mounted) return;
    widget.onDraft(
      planDraft(
        request: widget.request,
        decision: _decision,
        editedPlan: _plan.text,
        feedback: _feedback.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (widget.request.path case final path?) Text(path),
      if (_editing)
        TextField(
          key: const ValueKey('plan-edit'),
          controller: _plan,
          maxLines: null,
          onChanged: (_) => _report(),
        )
      else
        AdaptiveMarkdownBody(data: _plan.text, selectable: true),
      if (widget.request.editable && !_editing)
        TextButton(
          onPressed: () => setState(() => _editing = true),
          child: const Text('Edit the plan'),
        ),
      SegmentedButton<PlanDecision>(
        segments: const [
          ButtonSegment(value: PlanDecision.approve, label: Text('Approve')),
          ButtonSegment(value: PlanDecision.reject, label: Text('Reject')),
        ],
        selected: {_decision},
        onSelectionChanged: (picked) {
          setState(() => _decision = picked.single);
          _report();
        },
      ),
      if (_decision == PlanDecision.reject)
        TextField(
          key: const ValueKey('plan-feedback'),
          controller: _feedback,
          decoration: const InputDecoration(labelText: 'What should change'),
          onChanged: (_) => _report(),
        ),
    ],
  );
}

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
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      if (request.server case final server?) Text('From $server'),
      OpenLinkButton(url: request.url),
      FilledButton(
        key: const ValueKey('external-done'),
        onPressed: () => onSubmit(const ExternalUrlReply()),
        child: const Text('I have finished there'),
      ),
    ],
  );
}

class ChoiceView extends StatefulWidget {
  const ChoiceView({super.key, required this.request, required this.onDraft});

  final ChoiceRequest request;
  final ValueChanged<ReplyDraft> onDraft;

  @override
  State<ChoiceView> createState() => _ChoiceViewState();
}

class _ChoiceViewState extends State<ChoiceView> {
  String? _value;

  @override
  Widget build(BuildContext context) => Column(
    children: [
      for (final option in widget.request.options)
        ListTile(
          key: ValueKey('choice:${option.value}'),
          leading: Icon(
            option.value == _value
                ? Icons.radio_button_checked
                : Icons.radio_button_off,
          ),
          title: Text(option.label),
          subtitle: switch (option.description) {
            null => null,
            final description => Text(description),
          },
          onTap: () {
            setState(() => _value = option.value);
            widget.onDraft(DraftReply(ChoiceReply(value: option.value)));
          },
        ),
    ],
  );
}

class ConfirmView extends StatelessWidget {
  const ConfirmView({super.key, required this.onSubmit});

  final ValueChanged<InteractionReply> onSubmit;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisAlignment: MainAxisAlignment.end,
    children: [
      TextButton(
        key: const ValueKey('confirm-no'),
        onPressed: () => onSubmit(const ConfirmReply(confirmed: false)),
        child: const Text('No'),
      ),
      const SizedBox(width: Spacing.sm),
      FilledButton(
        key: const ValueKey('confirm-yes'),
        onPressed: () => onSubmit(const ConfirmReply(confirmed: true)),
        child: const Text('Yes'),
      ),
    ],
  );
}

/// Free text (contract §9, `text`), on one line unless the request is
/// multiline.
class TextAnswerView extends StatefulWidget {
  const TextAnswerView({
    super.key,
    required this.request,
    required this.onDraft,
  });

  final TextRequest request;
  final ValueChanged<ReplyDraft> onDraft;

  @override
  State<TextAnswerView> createState() => _TextAnswerViewState();
}

class _TextAnswerViewState extends State<TextAnswerView> {
  @override
  void initState() {
    super.initState();
    final initial = widget.request.initialText;
    if (initial != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) widget.onDraft(DraftReply(TextReply(text: initial)));
      });
    }
  }

  @override
  Widget build(BuildContext context) => TextFormField(
    key: const ValueKey('text-answer'),
    initialValue: widget.request.initialText,
    maxLines: widget.request.multiline ? null : 1,
    keyboardType: widget.request.multiline
        ? TextInputType.multiline
        : TextInputType.text,
    decoration: InputDecoration(hintText: widget.request.placeholder),
    onChanged: (text) => widget.onDraft(DraftReply(TextReply(text: text))),
  );
}
