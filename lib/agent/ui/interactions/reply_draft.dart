import 'dart:convert';

import 'package:broski/contract/generated/contract.dart';

/// What the person has filled in so far: a reply to check and send, or a
/// problem the reply cannot even be built past (input that is not JSON, a
/// number that is not one).
sealed class ReplyDraft {
  const ReplyDraft();
}

final class DraftReply extends ReplyDraft {
  const DraftReply(this.reply);

  final InteractionReply reply;
}

final class DraftProblem extends ReplyDraft {
  const DraftProblem(this.problem);

  final String problem;
}

/// A permission reply from the option chosen and what goes with it. A message
/// goes only with an option that takes one; edited input only when the
/// request lets it be edited and the text changed.
ReplyDraft permissionDraft({
  required ToolPermissionRequest request,
  required PermissionOption option,
  required String message,
  required Set<String> grantIds,
  required String? editedInputText,
}) {
  JsonValue? edited;
  if (editedInputText != null && option.effect == PermissionEffect.allow) {
    try {
      edited = JsonValue.fromJson(jsonDecode(editedInputText));
    } on FormatException {
      return const DraftProblem('The edited input is not valid JSON');
    }
  }
  final allows = option.effect == PermissionEffect.allow;
  return DraftReply(
    ToolPermissionReply(
      optionId: option.id,
      message: option.message == MessagePolicy.none || message.isEmpty
          ? null
          : message,
      editedInput: edited,
      grantIds: allows
          ? [
              for (final grant in request.grants)
                if (grantIds.contains(grant.id)) grant.id,
            ]
          : const [],
    ),
  );
}

/// What one question's answer holds while it is being chosen.
final class QuestionPick {
  const QuestionPick({this.selected = const {}, this.custom = ''});

  final Set<String> selected;
  final String custom;
}

/// Answers in the order the questions were asked; a question left untouched
/// is not answered, which the check accepts only when it is optional.
ReplyDraft questionsDraft(
  QuestionsRequest request,
  Map<String, QuestionPick> picks,
) => DraftReply(
  QuestionsReply(
    answers: [
      for (final question in request.questions)
        if (picks[question.id] case final pick?
            when pick.selected.isNotEmpty || pick.custom.isNotEmpty)
          QuestionAnswer(
            questionId: question.id,
            selected: [
              for (final option in question.options)
                if (pick.selected.contains(option.label)) option.label,
            ],
            custom: pick.custom.isEmpty ? null : pick.custom,
          ),
    ],
  ),
);

ReplyDraft planDraft({
  required PlanApprovalRequest request,
  required PlanDecision decision,
  required String editedPlan,
  required String feedback,
  String? modeAfter,
}) => DraftReply(
  PlanApprovalReply(
    decision: decision,
    modeAfter: decision == PlanDecision.approve ? modeAfter : null,
    plan:
        decision == PlanDecision.approve &&
            request.editable &&
            editedPlan != request.plan
        ? editedPlan
        : null,
    feedback: decision == PlanDecision.reject && feedback.isNotEmpty
        ? feedback
        : null,
  ),
);
