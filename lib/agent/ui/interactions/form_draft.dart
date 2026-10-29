import 'package:broski/agent/answers/field_check.dart';
import 'package:broski/agent/ui/interactions/reply_draft.dart';
import 'package:broski/contract/generated/contract.dart';

/// One form field's input as the person left it.
sealed class FieldInput {
  const FieldInput();
}

/// Text, and numbers as typed.
final class TextInput extends FieldInput {
  const TextInput(this.text);

  final String text;
}

/// A yes/no that stays unset until the person sets it, so an untouched field
/// is not answered for them.
final class FlagInput extends FieldInput {
  const FlagInput(this.value);

  final bool? value;
}

final class ChoicesInput extends FieldInput {
  const ChoicesInput(this.values);

  final List<String> values;
}

/// An external step (`ExternalField`): done once the person says so.
final class AckInput extends FieldInput {
  const AckInput(this.done);

  final bool done;
}

/// Every field's starting input, from its default when it has one.
Map<FieldKey, FieldInput> initialInputs(FormRequest request) => {
  for (final field in request.fields)
    field.key: switch (field) {
      StringField(:final defaultValue) => TextInput(defaultValue ?? ''),
      NumberField(:final defaultValue) => TextInput(_number(defaultValue)),
      IntegerField(:final defaultValue) => TextInput(
        defaultValue?.toString() ?? '',
      ),
      BooleanField(:final defaultValue) => FlagInput(defaultValue),
      MultiselectField(:final defaultValue) => ChoicesInput(
        defaultValue ?? const [],
      ),
      ExternalField() => const AckInput(false),
    },
};

String _number(double? value) => switch (value) {
  null => '',
  final whole when whole == whole.truncateToDouble() =>
    whole.toInt().toString(),
  final fraction => fraction.toString(),
};

/// The form reply: a value for every shown field the person filled in, and
/// none for a field its conditions leave inactive. Hidden fields are left to
/// the defaults the adapter fills in (contract §9).
ReplyDraft formDraft(FormRequest request, Map<FieldKey, FieldInput> inputs) {
  final (:values, :problem) = _collect(request, inputs);
  return problem == null
      ? DraftReply(FormReply(values: values))
      : DraftProblem(problem);
}

/// The values readable so far, active fields only: what the fields'
/// conditions are judged by while the person types.
Map<FieldKey, FormValue> answeredValues(
  FormRequest request,
  Map<FieldKey, FieldInput> inputs,
) => _collect(request, inputs).values;

({Map<FieldKey, FormValue> values, String? problem}) _collect(
  FormRequest request,
  Map<FieldKey, FieldInput> inputs,
) {
  final values = <FieldKey, FormValue>{};
  final unreadable = <FormFieldSpec, String>{};
  for (final field in request.fields) {
    if (_hidden(field)) continue;
    switch (_read(field, inputs[field.key])) {
      case _Unreadable(:final problem):
        unreadable[field] = problem;
      case _Value(:final value):
        values[field.key] = value;
      case _Empty():
        break;
    }
  }
  final kept = _activeOnly(request.fields, values);
  final problem = unreadable.entries
      .where((entry) => fieldIsActive(entry.key, kept))
      .map((entry) => entry.value)
      .firstOrNull;
  return (values: kept, problem: problem);
}

/// Drops answers to fields their conditions leave inactive, until dropping
/// one deactivates no other.
Map<FieldKey, FormValue> _activeOnly(
  List<FormFieldSpec> fields,
  Map<FieldKey, FormValue> values,
) {
  var kept = values;
  for (var round = 0; round <= fields.length; round++) {
    final next = {
      for (final field in fields)
        if (kept[field.key] case final value? when fieldIsActive(field, kept))
          field.key: value,
    };
    if (next.length == kept.length) return next;
    kept = next;
  }
  return kept;
}

bool _hidden(FormFieldSpec field) => switch (field) {
  ExternalField() => false,
  StringField(:final hidden) ||
  NumberField(:final hidden) ||
  IntegerField(:final hidden) ||
  BooleanField(:final hidden) ||
  MultiselectField(:final hidden) => hidden,
};

sealed class _Read {
  const _Read();
}

final class _Value extends _Read {
  const _Value(this.value);

  final FormValue value;
}

final class _Empty extends _Read {
  const _Empty();
}

final class _Unreadable extends _Read {
  const _Unreadable(this.problem);

  final String problem;
}

_Read _read(FormFieldSpec field, FieldInput? input) => switch ((field, input)) {
  (StringField(), TextInput(:final text)) =>
    text.isEmpty ? const _Empty() : _Value(TextValue(value: text)),
  (NumberField() || IntegerField(), TextInput(:final text)) => switch (text
      .trim()) {
    '' => const _Empty(),
    final typed => switch (double.tryParse(typed)) {
      null => _Unreadable('field ${field.key}: not a number'),
      final number => _Value(NumberValue(value: number)),
    },
  },
  (BooleanField(), FlagInput(:final value?)) => _Value(
    BooleanValue(value: value),
  ),
  (MultiselectField(), ChoicesInput(:final values)) =>
    values.isEmpty ? const _Empty() : _Value(ChoicesValue(values: values)),
  (ExternalField(), AckInput(done: true)) => const _Value(
    BooleanValue(value: true),
  ),
  _ => const _Empty(),
};
