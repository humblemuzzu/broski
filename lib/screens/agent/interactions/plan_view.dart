import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/answer_button.dart';
import 'package:broski/screens/agent/interactions/ask_field.dart';
import 'package:broski/screens/agent/interactions/code_box.dart';
import 'package:broski/screens/agent/interactions/plan_mode_picker.dart';
import 'package:broski/screens/agent/interactions/reply_draft.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
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
  late String? _mode = initialPlanMode(widget.request.modeOptions);
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
        modeAfter: _mode,
      ),
    );
  }

  void _decide(PlanDecision decision) {
    setState(() => _decision = decision);
    _report();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.request.path case final path?)
          Padding(
            padding: Insets.bottomMd,
            child: CodeBox(title: 'Plan file', text: path),
          ),
        _planBody(theme),
        if (widget.request.editable && !_editing) _editButton(),
        const SizedBox(height: Spacing.md),
        Row(
          children: [
            Expanded(child: _decisionButton(PlanDecision.reject)),
            const SizedBox(width: Spacing.sm),
            Expanded(child: _decisionButton(PlanDecision.approve)),
          ],
        ),
        if (widget.request.modeOptions case final options?
            when _decision == PlanDecision.approve)
          PlanModePicker(
            options: options,
            selected: _mode,
            onSelected: (mode) {
              setState(() => _mode = mode);
              _report();
            },
          ),
        if (_decision == PlanDecision.reject) _feedbackField(theme),
      ],
    );
  }

  Widget _planBody(OpenCodeTheme theme) => _editing
      ? TextField(
          key: const ValueKey('plan-edit'),
          controller: _plan,
          maxLines: null,
          style: AppTypography.codeSmall(color: theme.text),
          decoration: askInput(theme),
          onChanged: (_) => _report(),
        )
      : Container(
          padding: Insets.cardMd,
          decoration: BoxDecoration(
            color: theme.bgRaised,
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: AdaptiveMarkdownBody(data: _plan.text, selectable: true),
        );

  Widget _editButton() => Align(
    alignment: Alignment.centerLeft,
    child: Padding(
      padding: Insets.topSm,
      child: AnswerButton(
        label: 'Edit the plan',
        tone: AnswerTone.muted,
        icon: AppIcons.edit,
        onTap: () => setState(() => _editing = true),
      ),
    ),
  );

  Widget _decisionButton(PlanDecision decision) {
    final approve = decision == PlanDecision.approve;
    return AnswerButton(
      label: approve ? 'Approve' : 'Reject',
      tone: approve ? AnswerTone.primary : AnswerTone.deny,
      icon: approve ? AppIcons.check : AppIcons.close,
      selected: _decision == decision,
      onTap: () => _decide(decision),
    );
  }

  Widget _feedbackField(OpenCodeTheme theme) => Padding(
    padding: Insets.topSm,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const AskFieldLabel(text: 'What should change'),
        TextField(
          key: const ValueKey('plan-feedback'),
          controller: _feedback,
          style: AppTypography.body(color: theme.text),
          decoration: askInput(
            theme,
            hint: 'Smaller steps, another approach…',
            focus: theme.error,
          ),
          onChanged: (_) => _report(),
        ),
      ],
    ),
  );
}
