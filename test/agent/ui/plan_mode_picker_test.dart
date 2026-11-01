import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/reducer/snapshot_copy.dart';
import 'package:broski/agent/ui/interactions/interaction_sheet.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

const _modes = PlanModeOptions(
  axis: 'permissions',
  options: [
    Option(value: 'ask', label: 'Ask first'),
    Option(
      value: 'edits',
      label: 'Accept edits',
      description: 'Edits go through; commands still ask.',
    ),
    Option(value: 'auto', label: 'Auto'),
  ],
  defaultValue: 'edits',
);

Interaction _ask(PlanApprovalRequest request) => Interaction(
  id: 'i1',
  runId: 'r1',
  createdAt: 1,
  title: 'Approve the plan',
  blocksRun: true,
  request: request,
);

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

Future<WidgetRig> _plan(
  WidgetTester tester,
  PlanApprovalRequest request,
) async {
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

PlanApprovalReply _sent(WidgetRig rig) =>
    rig.sent<InteractionAnswerRequest>().answer.reply as PlanApprovalReply;

Future<void> _send(WidgetTester tester) async {
  await tester.tap(find.byKey(const ValueKey('answer-submit')));
  await tester.pumpAndSettle();
}

bool _chosen(WidgetTester tester, String mode) =>
    tester.widget<ChoiceChip>(find.byKey(ValueKey('plan-mode:$mode'))).selected;

void main() {
  testWidgets('the plan offers its modes with the default chosen, and the '
      'approval carries it', (tester) async {
    final rig = await _plan(
      tester,
      const PlanApprovalRequest(
        plan: '1. Do it',
        editable: false,
        modeOptions: _modes,
      ),
    );
    expect(_chosen(tester, 'edits'), isTrue);
    expect(_chosen(tester, 'ask'), isFalse);
    expect(find.text('Edits go through; commands still ask.'), findsOneWidget);
    await _send(tester);
    expect(_sent(rig).decision, PlanDecision.approve);
    expect(_sent(rig).modeAfter, 'edits');
  });

  testWidgets('another mode chosen is the one sent', (tester) async {
    final rig = await _plan(
      tester,
      const PlanApprovalRequest(
        plan: '1. Do it',
        editable: false,
        modeOptions: _modes,
      ),
    );
    await tester.tap(find.byKey(const ValueKey('plan-mode:auto')));
    await tester.pumpAndSettle();
    expect(_chosen(tester, 'auto'), isTrue);
    expect(_chosen(tester, 'edits'), isFalse);
    await _send(tester);
    expect(_sent(rig).modeAfter, 'auto');
  });

  testWidgets('a plan with no modes offered shows no picker and sends no '
      'mode', (tester) async {
    final rig = await _plan(
      tester,
      const PlanApprovalRequest(plan: '1. Do it', editable: false),
    );
    expect(find.text('Then continue in'), findsNothing);
    await _send(tester);
    expect(_sent(rig).modeAfter, isNull);
  });

  testWidgets('with no default and nothing chosen, no mode is sent', (
    tester,
  ) async {
    final rig = await _plan(
      tester,
      const PlanApprovalRequest(
        plan: '1. Do it',
        editable: false,
        modeOptions: PlanModeOptions(
          axis: 'permissions',
          options: [Option(value: 'ask', label: 'Ask first')],
        ),
      ),
    );
    expect(_chosen(tester, 'ask'), isFalse);
    await _send(tester);
    expect(_sent(rig).modeAfter, isNull);
  });

  testWidgets('rejecting hides the picker and carries no mode', (tester) async {
    final rig = await _plan(
      tester,
      const PlanApprovalRequest(
        plan: '1. Do it',
        editable: false,
        modeOptions: _modes,
      ),
    );
    await tester.tap(find.text('Reject'));
    await tester.pumpAndSettle();
    expect(find.text('Then continue in'), findsNothing);
    await tester.enterText(
      find.byKey(const ValueKey('plan-feedback')),
      'smaller',
    );
    await tester.pumpAndSettle();
    await _send(tester);
    expect(_sent(rig).decision, PlanDecision.reject);
    expect(_sent(rig).modeAfter, isNull);
  });
}
