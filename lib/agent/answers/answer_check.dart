import 'package:broski/agent/answers/field_check.dart';
import 'package:broski/agent/answers/js_text.dart';
import 'package:broski/contract/generated/contract.dart';

/// The Dart port of the contract's `answer-check.ts`: why [answer] is not a
/// valid answer to [interaction], or null when it is. The bridge runs the
/// TypeScript original on every answer; the app runs this first, so a human
/// sees the problem before anything is sent.
String? answerProblem(Interaction interaction, InteractionAnswer answer) {
  if (answer.interactionId != interaction.id) {
    return 'the answer names another interaction';
  }
  final request = interaction.request;
  return switch ((answer.reply, request)) {
    (CancelReply(), _) => null,
    (final ToolPermissionReply reply, final ToolPermissionRequest request) =>
      _permissionProblem(request, reply),
    (final QuestionsReply reply, final QuestionsRequest request) =>
      _questionsProblem(request, reply),
    (final FormReply reply, final FormRequest request) => _formProblem(
      request,
      reply,
    ),
    (final PlanApprovalReply reply, final PlanApprovalRequest request) =>
      _planProblem(request, reply),
    (final ChoiceReply reply, final ChoiceRequest request) =>
      request.options.any((option) => option.value == reply.value)
          ? null
          : 'not one of the options',
    (final TextReply reply, final TextRequest request) =>
      !request.multiline && RegExp('[\r\n]').hasMatch(reply.text)
          ? 'this text is a single line'
          : null,
    (ConfirmReply(), ConfirmRequest()) => null,
    (ExternalUrlReply(), ExternalUrlRequest()) => null,
    (final reply, final request) =>
      'a ${_replyKind(reply)} reply cannot answer a ${_requestKind(request)} interaction',
  };
}

String _replyKind(InteractionReply reply) => _wireKind(reply.toJson());

String _requestKind(InteractionRequest request) => _wireKind(request.toJson());

String _wireKind(Map<String, Object?> json) => switch (json['kind']) {
  final String kind => kind,
  _ => '',
};

String? _planProblem(PlanApprovalRequest request, PlanApprovalReply reply) {
  if (reply.decision == PlanDecision.approve && reply.feedback != null) {
    return 'feedback goes with a rejection';
  }
  if (reply.decision == PlanDecision.reject && reply.plan != null) {
    return 'an edited plan goes with an approval';
  }
  if (reply.plan != null && !request.editable) {
    return 'this plan cannot be edited';
  }
  return null;
}

String? _permissionProblem(
  ToolPermissionRequest request,
  ToolPermissionReply reply,
) {
  final option = request.options
      .where((candidate) => candidate.id == reply.optionId)
      .firstOrNull;
  if (option == null) return 'no option ${reply.optionId}';
  final message = reply.message;
  final hasMessage = message != null && !isJsBlank(message);
  if (option.message == MessagePolicy.none && message != null) {
    return 'this option takes no message';
  }
  if (option.message == MessagePolicy.required && !hasMessage) {
    return 'this option needs a message';
  }
  final allows = option.effect == PermissionEffect.allow;
  if (reply.editedInput != null && !(request.inputEditable && allows)) {
    return 'the input can only be edited when allowing an editable request';
  }
  if (reply.grantIds.toSet().length != reply.grantIds.length) {
    return 'a grant is listed twice';
  }
  final known = {for (final grant in request.grants) grant.id};
  if (reply.grantIds.any((id) => !known.contains(id))) {
    return 'a grant that was not requested';
  }
  if (!allows && reply.grantIds.isNotEmpty) return 'a denial grants nothing';
  if (allows && request.grants.isNotEmpty && reply.grantIds.isEmpty) {
    return 'allowing needs at least one grant';
  }
  return null;
}

String? _questionsProblem(QuestionsRequest request, QuestionsReply reply) {
  final answered = <String>{};
  for (final answer in reply.answers) {
    final question = request.questions
        .where((candidate) => candidate.id == answer.questionId)
        .firstOrNull;
    if (question == null) return 'no question ${answer.questionId}';
    final problem = _questionProblem(question, answer, answered);
    if (problem != null) return problem;
    answered.add(question.id);
  }
  final missing = request.questions
      .where((question) => question.required && !answered.contains(question.id))
      .firstOrNull;
  return missing == null ? null : 'question ${missing.id} needs an answer';
}

String? _questionProblem(
  Question question,
  QuestionAnswer answer,
  Set<String> answered,
) {
  final id = question.id;
  if (answered.contains(id)) return 'question $id is answered twice';
  final labels = {for (final option in question.options) option.label};
  if (answer.selected.any((label) => !labels.contains(label))) {
    return 'question $id: not one of the options';
  }
  if (answer.selected.toSet().length != answer.selected.length) {
    return 'question $id: an option twice';
  }
  final custom = answer.custom;
  if (custom != null && !question.allowCustom) {
    return 'question $id takes no free text';
  }
  if (custom != null && isJsBlank(custom)) {
    return 'question $id: empty free text';
  }
  final picks = answer.selected.length + (custom == null ? 0 : 1);
  if (!question.multiSelect && picks > 1) {
    return 'question $id takes one answer';
  }
  if (question.required && picks == 0) return 'question $id needs an answer';
  return null;
}

String? _formProblem(FormRequest request, FormReply reply) {
  final keys = {for (final field in request.fields) field.key};
  final unknown = jsPropertyOrder(
    reply.values.keys,
  ).where((key) => !keys.contains(key)).firstOrNull;
  if (unknown != null) return 'no field $unknown';
  for (final field in request.fields) {
    final problem = _fieldAnswerProblem(field, reply.values);
    if (problem != null) return problem;
  }
  return null;
}

String? _fieldAnswerProblem(
  FormFieldSpec field,
  Map<String, FormValue> values,
) {
  final key = field.key;
  final value = values[key];
  if (!fieldIsActive(field, values)) {
    return value == null ? null : 'field $key is not active';
  }
  if (value == null) {
    if (field is ExternalField) return 'field $key must be acknowledged';
    if (_isRequired(field) && !(_isHidden(field) && _hasDefault(field))) {
      return 'field $key is required';
    }
    return null;
  }
  final problem = fieldProblem(field, value);
  return problem == null ? null : 'field $key: $problem';
}

bool _isRequired(FormFieldSpec field) => switch (field) {
  ExternalField() => false,
  StringField(:final required) ||
  NumberField(:final required) ||
  IntegerField(:final required) ||
  BooleanField(:final required) ||
  MultiselectField(:final required) => required,
};

bool _isHidden(FormFieldSpec field) => switch (field) {
  ExternalField() => false,
  StringField(:final hidden) ||
  NumberField(:final hidden) ||
  IntegerField(:final hidden) ||
  BooleanField(:final hidden) ||
  MultiselectField(:final hidden) => hidden,
};

/// A hidden field's default answers for it (see `StringField.hidden`).
bool _hasDefault(FormFieldSpec field) => switch (field) {
  ExternalField() => false,
  StringField(:final defaultValue) => defaultValue != null,
  NumberField(:final defaultValue) => defaultValue != null,
  IntegerField(:final defaultValue) => defaultValue != null,
  BooleanField(:final defaultValue) => defaultValue != null,
  MultiselectField(:final defaultValue) => defaultValue != null,
};
