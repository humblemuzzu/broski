import 'package:broski/agent/answers/answer_check.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/reply_draft.dart';
import 'package:flutter_test/flutter_test.dart';

const _offering = PlanApprovalRequest(
  plan: '1. Do it',
  editable: false,
  modeOptions: PlanModeOptions(
    axis: 'permissions',
    options: [
      Option(value: 'ask', label: 'Ask first'),
      Option(value: 'edits', label: 'Accept edits'),
    ],
    defaultValue: 'ask',
  ),
);

PlanApprovalReply _reply(PlanDecision decision, String? modeAfter) =>
    switch (planDraft(
      request: _offering,
      decision: decision,
      editedPlan: _offering.plan,
      feedback: decision == PlanDecision.reject ? 'smaller' : '',
      modeAfter: modeAfter,
    )) {
      DraftReply(reply: final PlanApprovalReply reply) => reply,
      final other => throw StateError('not a plan reply: $other'),
    };

String? _problem(PlanApprovalReply reply) => answerProblem(
  const Interaction(
    id: 'plan',
    createdAt: 1,
    title: 'Approve',
    blocksRun: true,
    request: _offering,
  ),
  InteractionAnswer(interactionId: 'plan', reply: reply),
);

void main() {
  test('an approval carries the mode chosen, and passes the check', () {
    final reply = _reply(PlanDecision.approve, 'edits');
    expect(reply.modeAfter, 'edits');
    expect(_problem(reply), isNull);
  });

  test('a rejection drops the mode, and passes the check', () {
    final reply = _reply(PlanDecision.reject, 'edits');
    expect(reply.modeAfter, isNull);
    expect(_problem(reply), isNull);
  });

  test('a mode the plan does not offer is a problem before it is sent', () {
    expect(
      _problem(_reply(PlanDecision.approve, 'all')),
      'not one of the modes offered',
    );
  });
}
