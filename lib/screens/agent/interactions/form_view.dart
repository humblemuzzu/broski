import 'package:broski/agent/answers/field_check.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/form_draft.dart';
import 'package:broski/screens/agent/interactions/form_field_input.dart';
import 'package:broski/screens/agent/interactions/reply_draft.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// A form (contract §9, `form`): every field its conditions make active, as
/// the answers so far decide; hidden fields keep their defaults unseen.
class FormView extends StatefulWidget {
  const FormView({super.key, required this.request, required this.onDraft});

  final FormRequest request;
  final ValueChanged<ReplyDraft> onDraft;

  @override
  State<FormView> createState() => _FormViewState();
}

class _FormViewState extends State<FormView> {
  late final Map<FieldKey, FieldInput> _inputs = initialInputs(widget.request);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _report());
  }

  void _report() {
    if (mounted) widget.onDraft(formDraft(widget.request, _inputs));
  }

  void _set(FieldKey key, FieldInput input) {
    setState(() => _inputs[key] = input);
    _report();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final answers = answeredValues(widget.request, _inputs);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.request.server case final server?)
          Padding(
            padding: Insets.bottomSm,
            child: Text(
              'From $server',
              style: AppTypography.caption(color: theme.textMuted),
            ),
          ),
        for (final field in widget.request.fields)
          if (_shown(field) && fieldIsActive(field, answers))
            FormFieldInput(
              field: field,
              input: _inputs[field.key],
              onChanged: (input) => _set(field.key, input),
            ),
      ],
    );
  }
}

bool _shown(FormFieldSpec field) => switch (field) {
  ExternalField() => true,
  StringField(:final hidden) ||
  NumberField(:final hidden) ||
  IntegerField(:final hidden) ||
  BooleanField(:final hidden) ||
  MultiselectField(:final hidden) => !hidden,
};
