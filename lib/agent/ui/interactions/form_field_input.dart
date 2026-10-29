import 'package:broski/agent/ui/interactions/form_draft.dart';
import 'package:broski/agent/ui/interactions/open_link.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
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
    child: switch (field) {
      StringField(options: final options, allowCustom: false)
          when options.isNotEmpty =>
        _choice(options),
      final StringField string => _text(string.format, string.placeholder),
      NumberField() || IntegerField() => _text(null, null, numeric: true),
      BooleanField() => _flag(),
      final MultiselectField multi => _choices(multi),
      final ExternalField external => _external(external),
    },
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

  Widget _text(
    StringFormat? format,
    String? placeholder, {
    bool numeric = false,
  }) => TextFormField(
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
    decoration: InputDecoration(
      labelText: _label,
      helperText: field.description,
      hintText: placeholder ?? _formatHint(format),
    ),
    onChanged: (text) => onChanged(TextInput(text)),
  );

  Widget _choice(List<Option> options) => DropdownButtonFormField<String>(
    initialValue: options.any((option) => option.value == _typed)
        ? _typed
        : null,
    decoration: InputDecoration(
      labelText: _label,
      helperText: field.description,
    ),
    items: [
      for (final option in options)
        DropdownMenuItem(value: option.value, child: Text(option.label)),
    ],
    onChanged: (value) => onChanged(TextInput(value ?? '')),
  );

  Widget _flag() {
    final value = switch (input) {
      FlagInput(:final value) => value,
      _ => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_label, style: AppTypography.body()),
        if (field.description case final description?)
          Text(description, style: AppTypography.caption()),
        Wrap(
          spacing: Spacing.sm,
          children: [
            for (final choice in const [true, false])
              ChoiceChip(
                label: Text(choice ? 'Yes' : 'No'),
                selected: value == choice,
                onSelected: (_) => onChanged(FlagInput(choice)),
              ),
          ],
        ),
      ],
    );
  }

  Widget _choices(MultiselectField multi) {
    final chosen = switch (input) {
      ChoicesInput(:final values) => values,
      _ => const <String>[],
    };
    void toggle(String value) => onChanged(
      ChoicesInput(
        chosen.contains(value)
            ? [
                for (final held in chosen)
                  if (held != value) held,
              ]
            : [...chosen, value],
      ),
    );
    final custom = chosen.where(
      (value) => !multi.options.any((option) => option.value == value),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_label, style: AppTypography.body()),
        Wrap(
          spacing: Spacing.sm,
          children: [
            for (final option in multi.options)
              FilterChip(
                label: Text(option.label),
                selected: chosen.contains(option.value),
                onSelected: (_) => toggle(option.value),
              ),
            for (final value in custom)
              InputChip(label: Text(value), onDeleted: () => toggle(value)),
          ],
        ),
        if (multi.allowCustom)
          TextField(
            decoration: const InputDecoration(labelText: 'Add another'),
            onSubmitted: (value) {
              final trimmed = value.trim();
              if (trimmed.isNotEmpty && !chosen.contains(trimmed)) {
                toggle(trimmed);
              }
            },
          ),
      ],
    );
  }

  Widget _external(ExternalField external) {
    final done = switch (input) {
      AckInput(:final done) => done,
      _ => false,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_label, style: AppTypography.body()),
        if (external.description case final description?)
          Text(description, style: AppTypography.caption()),
        OpenLinkButton(url: external.url),
        CheckboxListTile(
          dense: true,
          value: done,
          title: const Text('I have finished there'),
          onChanged: (checked) => onChanged(AckInput(checked ?? false)),
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
