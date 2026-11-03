import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/interactions/interaction_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../agent/support/session_fixtures.dart';
import '../../agent/support/widget_rig.dart';

Interaction _ask(InteractionRequest request) => Interaction(
  id: 'i1',
  runId: 'r1',
  createdAt: 1,
  title: 'Asked',
  blocksRun: true,
  request: request,
);

/// The session's first pending ask, answered in the form under test.
class _Host extends ConsumerWidget {
  const _Host();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asked = ref.watch(sessionProvider(sessionRef)).snapshot.interactions;
    return Scaffold(
      body: SingleChildScrollView(
        child: asked.isEmpty
            ? const Text('nothing asked')
            : InteractionAnswerForm(
                session: sessionRef,
                interaction: asked.first,
              ),
      ),
    );
  }
}

Future<WidgetRig> _pump(WidgetTester tester, InteractionRequest request) async {
  final rig = WidgetRig(
    snapshot: replacing(emptySnapshot(), interactions: [_ask(request)]),
  );
  addTearDown(rig.dispose);
  rig.bridge.on<InteractionAnswerRequest>(
    (request) => InteractionAnswerResponse(
      requestId: request.requestId,
      result: const ActionAccepted(),
    ),
  );
  await rig.pump(tester, const _Host());
  return rig;
}

InteractionReply _sent(WidgetRig rig) =>
    rig.sent<InteractionAnswerRequest>().answer.reply;

PermissionOption _option(
  String id,
  PermissionEffect effect,
  MessagePolicy message,
) => PermissionOption(
  id: id,
  label: id,
  effect: effect,
  scope: PermissionScope.once,
  stopsRun: false,
  message: message,
);

ToolPermissionRequest _permission({required bool deliberate}) =>
    ToolPermissionRequest(
      inputEditable: false,
      previews: const [CommandPreview(command: 'rm -rf build')],
      options: [
        _option('allow', PermissionEffect.allow, MessagePolicy.none),
        _option('explain', PermissionEffect.deny, MessagePolicy.required),
      ],
      grants: const [],
      deliberate: deliberate,
    );

void main() {
  testWidgets('a permission answers on one tap unless it is deliberate', (
    tester,
  ) async {
    final rig = await _pump(tester, _permission(deliberate: false));
    expect(find.text('rm -rf build'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('permission-option:allow')));
    await tester.pumpAndSettle();
    expect((_sent(rig) as ToolPermissionReply).optionId, 'allow');
  });

  testWidgets('a second tap while the answer is on its way sends nothing', (
    tester,
  ) async {
    final rig = await _pump(tester, _permission(deliberate: false));
    rig.bridge.on<InteractionAnswerRequest>((_) => null);
    final option = find.byKey(const ValueKey('permission-option:allow'));
    await tester.tap(option);
    await tester.tap(option);
    await tester.pump();
    expect(rig.link.sent.whereType<InteractionAnswerRequest>(), hasLength(1));
    expect(find.text('Your answer is already on its way'), findsNothing);
  });

  testWidgets('a deliberate permission needs a choice and then Send', (
    tester,
  ) async {
    final rig = await _pump(tester, _permission(deliberate: true));
    await tester.tap(find.byKey(const ValueKey('permission-option:allow')));
    await tester.pumpAndSettle();
    expect(rig.link.sent.whereType<InteractionAnswerRequest>(), isEmpty);
    await tester.tap(find.byKey(const ValueKey('answer-submit')));
    await tester.pumpAndSettle();
    expect((_sent(rig) as ToolPermissionReply).optionId, 'allow');
  });

  testWidgets('a required message is asked for before the answer can go', (
    tester,
  ) async {
    final rig = await _pump(tester, _permission(deliberate: true));
    await tester.tap(find.byKey(const ValueKey('permission-option:explain')));
    await tester.pumpAndSettle();
    expect(find.text('this option needs a message'), findsOneWidget);
    await tester.enterText(
      find.byKey(const ValueKey('permission-message')),
      'use rg',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('answer-submit')));
    await tester.pumpAndSettle();
    expect((_sent(rig) as ToolPermissionReply).message, 'use rg');
  });

  testWidgets('questions take an option or free text, the secret one hidden', (
    tester,
  ) async {
    const request = QuestionsRequest(
      questions: [
        Question(
          id: 'q0',
          text: 'Which library?',
          options: [
            QuestionOption(label: 'a'),
            QuestionOption(label: 'b'),
          ],
          multiSelect: false,
          allowCustom: false,
          secret: false,
          required: true,
        ),
        Question(
          id: 'q1',
          text: 'Token?',
          options: [],
          multiSelect: false,
          allowCustom: true,
          secret: true,
          required: false,
        ),
      ],
    );
    final rig = await _pump(tester, request);
    await tester.enterText(
      find.byKey(const ValueKey('question-custom:q1')),
      's3cret',
    );
    await tester.pumpAndSettle();
    expect(find.text('question q0 needs an answer'), findsOneWidget);
    final secret = tester.widget<TextField>(
      find.byKey(const ValueKey('question-custom:q1')),
    );
    expect(secret.obscureText, isTrue);
    await tester.tap(find.byKey(const ValueKey('question:q0:b')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('answer-submit')));
    await tester.pumpAndSettle();
    final answers = (_sent(rig) as QuestionsReply).answers;
    expect([for (final a in answers) a.questionId], ['q0', 'q1']);
    expect(answers.first.selected, ['b']);
    expect(answers.last.custom, 's3cret');
  });

  testWidgets('a form shows a field only while its conditions hold, and '
      'checks formats with the contract rules', (tester) async {
    const request = FormRequest(
      fields: [
        StringField(
          key: 'email',
          required: true,
          hidden: false,
          when: [],
          format: StringFormat.email,
          options: [],
          allowCustom: false,
        ),
        BooleanField(key: 'notify', required: false, hidden: false, when: []),
        MultiselectField(
          key: 'channels',
          required: true,
          hidden: false,
          when: [
            FieldCondition(
              key: 'notify',
              op: ConditionOperator.eq,
              value: BooleanValue(value: true),
            ),
          ],
          options: [Option(value: 'mail', label: 'Mail')],
          allowCustom: false,
        ),
        StringField(
          key: 'token',
          required: true,
          hidden: true,
          when: [],
          defaultValue: 't',
          options: [],
          allowCustom: false,
        ),
      ],
    );
    final rig = await _pump(tester, request);
    expect(find.byKey(const ValueKey('form-field:channels')), findsNothing);
    expect(find.byKey(const ValueKey('form-field:token')), findsNothing);
    await tester.enterText(find.byType(TextFormField).first, 'nope');
    await tester.pumpAndSettle();
    expect(find.text('field email: not a valid email'), findsOneWidget);
    await tester.enterText(find.byType(TextFormField).first, 'a@b.co');
    await tester.tap(find.text('Yes'));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('form-field:channels')), findsOneWidget);
    expect(find.text('field channels is required'), findsOneWidget);
    await tester.tap(find.text('Mail'));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('answer-submit')));
    await tester.pumpAndSettle();
    final values = (_sent(rig) as FormReply).values;
    expect(values.keys, unorderedEquals(['email', 'notify', 'channels']));
  });

  testWidgets('a plan is rejected with feedback', (tester) async {
    final rig = await _pump(
      tester,
      const PlanApprovalRequest(plan: '1. Do it', editable: true),
    );
    await tester.tap(find.text('Reject'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byKey(const ValueKey('plan-feedback')),
      'smaller',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('answer-submit')));
    await tester.pumpAndSettle();
    final reply = _sent(rig) as PlanApprovalReply;
    expect(reply.decision, PlanDecision.reject);
    expect(reply.feedback, 'smaller');
  });

  testWidgets('an external step answers once the person is done there', (
    tester,
  ) async {
    final external = await _pump(
      tester,
      const ExternalUrlRequest(url: 'https://example.com/auth'),
    );
    await tester.tap(find.byKey(const ValueKey('external-done')));
    await tester.pumpAndSettle();
    expect(_sent(external), isA<ExternalUrlReply>());
  });

  testWidgets('a confirm answers from its own buttons', (tester) async {
    final rig = await _pump(tester, const ConfirmRequest());
    await tester.tap(find.byKey(const ValueKey('confirm-no')));
    await tester.pumpAndSettle();
    expect((_sent(rig) as ConfirmReply).confirmed, isFalse);
  });

  testWidgets('a choice is one of its options', (tester) async {
    final rig = await _pump(
      tester,
      const ChoiceRequest(
        options: [Option(value: 'retry', label: 'Retry')],
      ),
    );
    await tester.tap(find.byKey(const ValueKey('choice:retry')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('answer-submit')));
    await tester.pumpAndSettle();
    expect((_sent(rig) as ChoiceReply).value, 'retry');
  });

  testWidgets('single-line text never carries a newline', (tester) async {
    final rig = await _pump(tester, const TextRequest(multiline: false));
    await tester.enterText(find.byKey(const ValueKey('text-answer')), 'ma\nin');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('answer-submit')));
    await tester.pumpAndSettle();
    expect((_sent(rig) as TextReply).text, 'main');
  });

  testWidgets('multiline text keeps its lines', (tester) async {
    final rig = await _pump(tester, const TextRequest(multiline: true));
    await tester.enterText(find.byKey(const ValueKey('text-answer')), 'a\nb');
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('answer-submit')));
    await tester.pumpAndSettle();
    expect((_sent(rig) as TextReply).text, 'a\nb');
  });

  testWidgets('skipping answers with a cancel that says whether to stop', (
    tester,
  ) async {
    final rig = await _pump(tester, const ConfirmRequest());
    await tester.tap(find.byKey(const ValueKey('answer-skip')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Skip, and stop the run'));
    await tester.pumpAndSettle();
    expect((_sent(rig) as CancelReply).stopRun, isTrue);
  });
}
