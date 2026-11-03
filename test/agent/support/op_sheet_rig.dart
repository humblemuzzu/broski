import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'widget_rig.dart';

const opSession = SessionRef(backend: BackendId.claudeCode, sessionId: 's1');

Capabilities offering(List<String> ops) =>
    Capabilities.fromJson({...everything.toJson(), 'backendOps': ops});

BackendCallResponse answered(BackendCallRequest request, BackendOpResult r) =>
    BackendCallResponse(
      requestId: request.requestId,
      result: BackendCallAccepted(result: r),
    );

BackendCallResponse refused(
  BackendCallRequest request,
  RejectionCode code,
  String message,
) => BackendCallResponse(
  requestId: request.requestId,
  result: Rejected(
    rejection: Rejection(code: code, message: message),
  ),
);

ClaudeCodeOp lastOp(WidgetRig rig) =>
    (rig.sent<BackendCallRequest>().call as ClaudeCodeCall).op;

List<ClaudeCodeOp> allOps(WidgetRig rig) => [
  for (final request in rig.link.sent.whereType<BackendCallRequest>())
    (request.call as ClaudeCodeCall).op,
];

Finder byKey(String key) => find.byKey(ValueKey(key));

Future<void> tapKey(WidgetTester tester, String key) async {
  await tester.pump();
  await tester.ensureVisible(byKey(key));
  await tester.tap(byKey(key));
  await tester.pumpAndSettle();
}

/// The chat of a session in `/work` whose backend lists [ops]; a test opens
/// a panel from its More sheet and scripts the `backend.call` answers.
Future<WidgetRig> openChat(WidgetTester tester, List<String> ops) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final capabilities = offering(ops);
  final rig = WidgetRig(capabilities: capabilities);
  rig.bridge
    ..on<BackendsListRequest>(
      (request) => BackendsListResponse(
        requestId: request.requestId,
        backends: [
          BackendDescriptor(id: opSession.backend, capabilities: capabilities),
        ],
      ),
    )
    ..on<SessionGetRequest>(
      (request) => SessionGetResponse(
        requestId: request.requestId,
        result: const SessionFound(
          summary: SessionSummary(
            session: opSession,
            updatedAt: 1,
            archived: false,
            status: SessionStatus.idle,
            origin: SessionOrigin.broski,
            cwd: '/work',
          ),
        ),
      ),
    );
  addTearDown(rig.dispose);
  await rig.pump(tester, const AgentChatScreen(session: opSession));
  return rig;
}

Future<void> openPanel(WidgetTester tester, String kind) async {
  await tapKey(tester, 'chat-panels');
  await tapKey(tester, 'panel:$kind');
}
