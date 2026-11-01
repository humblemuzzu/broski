import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/session_fixtures.dart';
import '../../support/widget_rig.dart';

final _capabilities = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': [
    'navigate_tree',
    'read_tree',
    'label_entry',
    'abort_branch_summary',
  ],
});

TreeNode _node(
  String id,
  TreeNodeKind kind,
  String preview, {
  String? parent,
  int at = 0,
  String? label,
  bool cut = false,
}) => TreeNode(
  id: id,
  parentId: parent,
  itemId: '$id:0',
  kind: kind,
  at: at,
  preview: preview,
  previewCut: cut,
  label: label,
);

final _newest = [
  _node('a2', TreeNodeKind.assistant, 'Second answer', parent: 'u2', at: 4),
  _node('u2', TreeNodeKind.user, 'Second question', parent: 'a1', at: 3),
  _node(
    'a1',
    TreeNodeKind.assistant,
    'First answer',
    parent: 'u1',
    at: 2,
    label: 'checkpoint',
  ),
];

final _oldest = [_node('u1', TreeNodeKind.user, 'First question', at: 1)];

BackendCallResponse _read(
  BackendCallRequest request,
  List<TreeNode> nodes, {
  String? next,
  int? total,
}) => BackendCallResponse(
  requestId: request.requestId,
  result: BackendCallAccepted(
    result: TreeRead(
      leafId: 'a2',
      total: total ?? nodes.length,
      nodes: nodes,
      nextCursor: next,
    ),
  ),
);

PiOp _op(BackendCallRequest request) => (request.call as PiCall).op;

Future<WidgetRig> _tree(
  WidgetTester tester, {
  List<TreeNode>? first,
  String? next = 'more',
  int? total,
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final rig = WidgetRig(capabilities: _capabilities);
  addTearDown(rig.dispose);
  rig.bridge.on<BackendCallRequest>((request) {
    final op = _op(request);
    if (op is! ReadTreeOp) return null;
    return op.page.cursor == null
        ? _read(request, first ?? _newest, next: next, total: total ?? 4)
        : _read(request, _oldest, total: 4);
  });
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  await tester.tap(find.byKey(const ValueKey('chat-panels')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const ValueKey('panel:read_tree')));
  await tester.pumpAndSettle();
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

Future<void> _tap(WidgetTester tester, Finder target) async {
  await tester.tap(target);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows the newest entries with the position and the labels, and '
      'reads the earlier ones when asked', (tester) async {
    final rig = await _tree(tester);
    final sheet = find.ancestor(
      of: _key('tree-panel'),
      matching: find.byType(DetailSheet),
    );
    expect(tester.widget<DetailSheet>(sheet).title, 'Session tree');
    expect(find.text('Second answer'), findsOneWidget);
    expect(find.text('First answer'), findsOneWidget);
    expect(find.text('#checkpoint'), findsOneWidget);
    expect(find.textContaining('you are here'), findsOneWidget);
    expect(find.text('First question'), findsNothing);
    expect(find.text('Load earlier entries (1 more)'), findsOneWidget);

    await _tap(tester, _key('tree-more'));
    final read = rig.sent<BackendCallRequest>();
    expect((_op(read) as ReadTreeOp).page.cursor, 'more');
    expect(find.text('First question'), findsOneWidget);
    expect(_key('tree-more'), findsNothing);
  });

  testWidgets('each node is one button to a screen reader, said in one '
      'phrase', (tester) async {
    final semantics = tester.ensureSemantics();
    await _tree(tester);
    final here = find.bySemanticsLabel(
      'Assistant, you are here, Second answer',
    );
    expect(here, findsOneWidget);
    expect(
      tester.getSemantics(here),
      matchesSemantics(
        label: 'Assistant, you are here, Second answer',
        isButton: true,
        isEnabled: true,
        hasEnabledState: true,
        hasTapAction: true,
      ),
    );
    expect(
      find.bySemanticsLabel('Assistant, First answer, label checkpoint'),
      findsOneWidget,
    );
    semantics.dispose();
  });

  testWidgets('says how many entries a capped tree leaves out', (tester) async {
    await _tree(tester, next: null, total: 5000);
    expect(
      find.textContaining('Showing the newest 3 of 5000 entries'),
      findsOneWidget,
    );
  });

  testWidgets('continuing from a node sends the move and closes the tree; a '
      'message of your own comes back to the composer', (tester) async {
    final rig = await _tree(tester);
    rig.bridge.on<BackendCallRequest>(
      (request) => _op(request) is NavigateTreeOp
          ? BackendCallResponse(
              requestId: request.requestId,
              result: const BackendCallAccepted(result: TreeNavigated()),
            )
          : null,
    );
    await _tap(tester, _key('tree-node:u2'));
    await _tap(tester, _key('tree-continue'));
    expect(
      _op(rig.sent<BackendCallRequest>()),
      const NavigateTreeOp(sessionId: 's1', itemId: 'u2:0', summarize: false),
    );
    expect(_key('tree-panel'), findsNothing);
    final composer = tester.widget<TextField>(_key('composer-text'));
    expect(composer.controller?.text, 'Second question');
  });

  testWidgets('a summary written with your own prompt can be cancelled, and a '
      'cancelled move says nothing', (tester) async {
    final rig = await _tree(tester);
    await _tap(tester, _key('tree-node:a1'));
    await _tap(tester, _key('tree-continue-summary-with'));
    await tester.enterText(find.byType(TextField).last, 'the files');
    await tester.tap(find.text('Summarise'));
    await WidgetRig.settle(tester);
    final move = rig.bridge.waiting<BackendCallRequest>();
    expect(
      _op(move),
      const NavigateTreeOp(
        sessionId: 's1',
        itemId: 'a1:0',
        summarize: true,
        instructions: 'the files',
      ),
    );
    expect(_key('tree-working'), findsOneWidget);

    rig.bridge.on<BackendCallRequest>(
      (request) => _op(request) is AbortBranchSummaryOp
          ? BackendCallResponse(
              requestId: request.requestId,
              result: const BackendCallAccepted(result: BranchSummaryAborted()),
            )
          : _op(request) is ReadTreeOp
          ? _read(request, _newest, total: 3)
          : null,
    );
    await tester.tap(_key('tree-cancel-summary'));
    await WidgetRig.settle(tester);
    expect(
      _op(rig.sent<BackendCallRequest>()),
      const AbortBranchSummaryOp(sessionId: 's1'),
    );
    rig.bridge.answer(
      BackendCallResponse(
        requestId: move.requestId,
        result: const Rejected(
          rejection: Rejection(
            code: RejectionCode.backendError,
            message: 'summarizing the branch was cancelled',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('was cancelled'), findsNothing);
    expect(_key('tree-working'), findsNothing);
    expect(_key('tree-panel'), findsOneWidget);
  });

  testWidgets('labels are set and cleared', (tester) async {
    final rig = await _tree(tester);
    rig.bridge.on<BackendCallRequest>(
      (request) => _op(request) is LabelEntryOp
          ? BackendCallResponse(
              requestId: request.requestId,
              result: const BackendCallAccepted(result: EntryLabelled()),
            )
          : _op(request) is ReadTreeOp
          ? _read(request, _newest, total: 3)
          : null,
    );
    await _tap(tester, _key('tree-node:u2'));
    await _tap(tester, _key('tree-label'));
    await tester.enterText(find.byType(TextField).last, 'idea');
    await _tap(tester, find.text('Save'));
    expect(
      rig.link.sent
          .whereType<BackendCallRequest>()
          .map(_op)
          .whereType<LabelEntryOp>()
          .single,
      const LabelEntryOp(sessionId: 's1', entryId: 'u2', label: 'idea'),
    );

    await _tap(tester, _key('tree-node:a1'));
    await _tap(tester, _key('tree-unlabel'));
    expect(
      rig.link.sent
          .whereType<BackendCallRequest>()
          .map(_op)
          .whereType<LabelEntryOp>()
          .last,
      const LabelEntryOp(sessionId: 's1', entryId: 'a1'),
    );
  });

  testWidgets('a bridge that does not list the tree offers no panel for it', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(1200, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final rig = WidgetRig(
      capabilities: Capabilities.fromJson({
        ...everything.toJson(),
        'backendOps': ['navigate_tree'],
      }),
    );
    addTearDown(rig.dispose);
    await rig.pump(tester, const AgentChatScreen(session: sessionRef));
    expect(_key('panel:read_tree'), findsNothing);
  });
}
