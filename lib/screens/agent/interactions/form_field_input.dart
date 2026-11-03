import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/ask_field.dart';
import 'package:broski/screens/agent/interactions/choice_mark.dart';
import 'package:broski/screens/agent/interactions/form_draft.dart';
import 'package:broski/screens/agent/interactions/open_link.dart';
import 'package:broski/screens/agent/shared/select_pill.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The input one form field needs, by its kind and format. Nothing is
/// refused as it is typed: the contract's check says what is wrong.
class FormFieldInput extends StatelessWidget {
  const FormFieldInput({
    super.key,
    required this.field,
    required this.input,
    required this.onChanged,
  });

  final FormFieldSpec field;
  final FieldInput? input;
  final ValueChanged<FieldInput> onChanged;

  @override
  Widget build(BuildContext context) => Padding(
    key: ValueKey('form-field:${field.key}'),
    padding: Insets.bottomMd,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _header(context),
        switch (field) {
          StringField(options: final options, allowCustom: false)
              when options.isNotEmpty =>
            _one(options),
          final StringField string => _text(
            context,
            string.format,
            string.placeholder,
          ),
          NumberField() ||
          IntegerField() => _text(context, null, null, numeric: true),
          BooleanField() => _flag(),
          final MultiselectField multi => _many(context, multi),
          final ExternalField external => _external(context, external),
        },
      ],
    ),
  );

  String get _label {
    final title = field.title ?? field.key;
    final required = switch (field) {
      ExternalField() => true,
      StringField(:final required) ||
      NumberField(:final required) ||
      IntegerField(:final required) ||
      BooleanField(:final required) ||
      MultiselectField(:final required) => required,
    };
    return required ? '$title *' : title;
  }

  String get _typed => switch (input) {
    TextInput(:final text) => text,
    _ => '',
  };

  Widget _header(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        AskFieldLabel(text: _label),
        if (field.description case final description?)
          Padding(
            padding: Insets.bottomSm,
            child: Text(
              description,
              style: AppTypography.caption(color: theme.textMuted),
            ),
          ),
      ],
    );
  }

  Widget _text(
    BuildContext context,
    StringFormat? format,
    String? placeholder, {
    bool numeric = false,
  }) {
    final theme = OpenCodeTheme.of(context);
    return TextFormField(
      initialValue: _typed,
      keyboardType: numeric
          ? const TextInputType.numberWithOptions(decimal: true, signed: true)
          : switch (format) {
              StringFormat.email => TextInputType.emailAddress,
              StringFormat.uri => TextInputType.url,
              StringFormat.date ||
              StringFormat.dateTime => TextInputType.datetime,
              null => TextInputType.text,
            },
      style: AppTypography.body(color: theme.text),
      decoration: askInput(theme, hint: placeholder ?? _formatHint(format)),
      onChanged: (text) => onChanged(TextInput(text)),
    );
  }

  Widget _one(List<Option> options) => Wrap(
    spacing: Spacing.sm,
    runSpacing: Spacing.sm,
    children: [
      for (final option in options)
        SelectPill(
          label: option.label,
          selected: option.value == _typed,
          onTap: () => onChanged(TextInput(option.value)),
        ),
    ],
  );

  Widget _flag() {
    final value = switch (input) {
      FlagInput(:final value) => value,
      _ => null,
    };
    return Wrap(
      spacing: Spacing.sm,
      children: [
        for (final choice in const [true, false])
          SelectPill(
            label: choice ? 'Yes' : 'No',
            selected: value == choice,
            onTap: () => onChanged(FlagInput(choice)),
          ),
      ],
    );
  }

  Widget _many(BuildContext context, MultiselectField multi) {
    final chosen = _chosen;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _choiceChips(multi, chosen),
        if (multi.allowCustom) _customEntry(context, chosen),
      ],
    );
  }

  List<String> get _chosen => switch (input) {
    ChoicesInput(:final values) => values,
    _ => const <String>[],
  };

  void _toggle(List<String> chosen, String value) => onChanged(
    ChoicesInput(
      chosen.contains(value)
          ? [
              for (final held in chosen)
                if (held != value) held,
            ]
          : [...chosen, value],
    ),
  );

  Widget _choiceChips(MultiselectField multi, List<String> chosen) {
    final custom = chosen.where(
      (value) => !multi.options.any((option) => option.value == value),
    );
    return Wrap(
      spacing: Spacing.sm,
      runSpacing: Spacing.sm,
      children: [
        for (final option in multi.options)
          SelectPill(
            label: option.label,
            selected: chosen.contains(option.value),
            onTap: () => _toggle(chosen, option.value),
          ),
        for (final value in custom)
          SelectPill(
            label: value,
            selected: true,
            icon: AppIcons.close,
            onTap: () => _toggle(chosen, value),
          ),
      ],
    );
  }

  Widget _customEntry(BuildContext context, List<String> chosen) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.topSm,
      child: TextField(
        style: AppTypography.body(color: theme.text),
        decoration: askInput(theme, hint: 'Add another'),
        onSubmitted: (value) {
          final trimmed = value.trim();
          if (trimmed.isNotEmpty && !chosen.contains(trimmed)) {
            _toggle(chosen, trimmed);
          }
        },
      ),
    );
  }

  Widget _external(BuildContext context, ExternalField external) {
    final theme = OpenCodeTheme.of(context);
    final done = switch (input) {
      AckInput(:final done) => done,
      _ => false,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        OpenLinkButton(url: external.url),
        Padding(
          padding: Insets.topSm,
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => onChanged(AckInput(!done)),
            child: Row(
              children: [
                ChoiceMark(selected: done, square: true),
                const SizedBox(width: Spacing.sm),
                Text(
                  'I have finished there',
                  style: AppTypography.body(
                    color: done ? theme.text : theme.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

String? _formatHint(StringFormat? format) => switch (format) {
  StringFormat.email => 'name@example.com',
  StringFormat.uri => 'https://…',
  StringFormat.date => 'YYYY-MM-DD',
  StringFormat.dateTime => 'YYYY-MM-DDThh:mm:ssZ',
  null => null,
};
