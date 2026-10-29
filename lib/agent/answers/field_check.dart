import 'package:broski/agent/answers/js_pattern.dart';
import 'package:broski/agent/answers/js_text.dart';
import 'package:broski/agent/answers/string_formats.dart';
import 'package:broski/contract/generated/contract.dart';

/// The Dart port of the contract's `field-check.ts`: whether a form field is
/// active, and whether one value fits one field. Where backends validate
/// differently it is the strictest of them, so no backend refuses an answer it
/// passes. `test/agent/answers/answer_cases_test.dart` holds it to the
/// TypeScript verdicts.
bool fieldIsActive(FormFieldSpec field, Map<String, FormValue> values) =>
    switch (field) {
      ExternalField() => true,
      StringField(when: final conditions) ||
      NumberField(when: final conditions) ||
      IntegerField(when: final conditions) ||
      BooleanField(when: final conditions) ||
      MultiselectField(when: final conditions) => conditions.every(
        (condition) => _holds(condition, values[condition.key]),
      ),
    };

/// A condition on an unanswered field is false for both operators; against a
/// multiselect answer `eq` means "includes".
bool _holds(FieldCondition condition, FormValue? answer) {
  if (answer == null) return false;
  final expected = condition.value;
  final matches = switch ((answer, expected)) {
    (ChoicesValue(:final values), TextValue(:final value)) => values.contains(
      value,
    ),
    (ChoicesValue(), _) => false,
    (TextValue(value: final a), TextValue(value: final b)) => a == b,
    (NumberValue(value: final a), NumberValue(value: final b)) => a == b,
    (BooleanValue(value: final a), BooleanValue(value: final b)) => a == b,
    _ => false,
  };
  return condition.op == ConditionOperator.eq ? matches : !matches;
}

/// Why [value] does not fit [field], or null when it does.
String? fieldProblem(FormFieldSpec field, FormValue value) => switch (field) {
  StringField() =>
    value is TextValue ? _stringProblem(field, value.value) : 'expects text',
  NumberField(:final minimum, :final maximum) => _numberProblem(
    value,
    integer: false,
    minimum: minimum,
    maximum: maximum,
  ),
  IntegerField(:final minimum, :final maximum) => _numberProblem(
    value,
    integer: true,
    minimum: minimum?.toDouble(),
    maximum: maximum?.toDouble(),
  ),
  BooleanField() => value is BooleanValue ? null : 'expects true or false',
  MultiselectField() => _choicesProblem(field, value),
  ExternalField() =>
    value is BooleanValue && value.value
        ? null
        : 'must be acknowledged with true',
};

String? _numberProblem(
  FormValue value, {
  required bool integer,
  required double? minimum,
  required double? maximum,
}) {
  if (value is! NumberValue) return 'expects a number';
  if (integer && !isJsInteger(value.value)) return 'expects an integer';
  if (minimum != null && value.value < minimum) return 'below the minimum';
  if (maximum != null && value.value > maximum) return 'above the maximum';
  return null;
}

String? _choicesProblem(MultiselectField field, FormValue value) {
  if (value is! ChoicesValue) return 'expects choices';
  final choices = value.values;
  if (field.required && choices.isEmpty) return 'needs a choice';
  if (choices.toSet().length != choices.length) return 'a choice twice';
  final minItems = field.minItems;
  if (minItems != null && choices.length < minItems) return 'too few choices';
  final maxItems = field.maxItems;
  if (maxItems != null && choices.length > maxItems) return 'too many choices';
  final options = {for (final option in field.options) option.value};
  return field.allowCustom || choices.every(options.contains)
      ? null
      : 'not an option';
}

/// Lengths count code points against `minLength` and UTF-16 units against
/// `maxLength`, so both readings pass.
String? _stringProblem(StringField field, String text) {
  if (field.required && text.isEmpty) return 'needs an answer';
  final minLength = field.minLength;
  if (minLength != null && codePointLength(text) < minLength) {
    return 'too short';
  }
  final maxLength = field.maxLength;
  if (maxLength != null && text.length > maxLength) return 'too long';
  final pattern = field.pattern;
  if (pattern != null) {
    final problem = patternProblem(pattern, text);
    if (problem != null) return problem;
  }
  final format = field.format;
  if (format != null && !matchesFormat(format, text)) {
    return 'not a valid ${format.wire}';
  }
  final allowed = field.options.isEmpty || field.allowCustom;
  return allowed || field.options.any((option) => option.value == text)
      ? null
      : 'not an option';
}
