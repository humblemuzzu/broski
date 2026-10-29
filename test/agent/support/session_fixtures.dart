import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/reducer/session_reducer.dart';
import 'package:broski/agent/session/prompt_handoff.dart';
import 'package:broski/agent/session/session_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_contract_link.dart';
import 'manual_clock.dart';
import 'scripted_bridge.dart';

const sessionRef = SessionRef(backend: BackendId.pi, sessionId: 's1');

const controllable = SessionCapabilities(
  controllable: true,
  compact: true,
  cancelQueued: true,
);

const summary = SessionSummary(
  session: sessionRef,
  updatedAt: 1,
  archived: false,
  status: SessionStatus.idle,
  origin: SessionOrigin.broski,
  cwd: '/work',
);

SessionAttachResponse snapshotAnswer(
  SessionAttachRequest request, {
  String epoch = 'e1',
  int lastSeq = 0,
  SessionSnapshot? snapshot,
  SessionCapabilities capabilities = controllable,
}) => SessionAttachResponse(
  requestId: request.requestId,
  capabilities: capabilities,
  sync: SnapshotSync(
    epoch: epoch,
    lastSeq: lastSeq,
    snapshot: snapshot ?? emptySnapshot(),
  ),
);

SessionAttachResponse replayAnswer(SessionAttachRequest request) =>
    SessionAttachResponse(
      requestId: request.requestId,
      capabilities: controllable,
      sync: ReplaySync(
        epoch: request.resume!.epoch,
        afterSeq: request.resume!.seq,
      ),
    );

ErrorResponse errorAnswer(
  ClientMessage request,
  ProtocolErrorCode code, {
  String message = 'refused',
}) => ErrorResponse(
  requestId: request.requestId,
  error: ProtocolError(code: code, message: message),
);

TranscriptReadResponse pageAnswer(
  TranscriptReadRequest request,
  List<TranscriptItem> newestFirst, {
  String? nextCursor,
  IdStability stability = IdStability.stable,
}) => TranscriptReadResponse(
  requestId: request.requestId,
  result: TranscriptRead(
    page: TranscriptPage(
      items: newestFirst,
      nextCursor: nextCursor,
      idStability: stability,
    ),
  ),
);

UserMessageItem userItem(String id, {String? clientRequestId}) =>
    UserMessageItem(
      id: id,
      text: id,
      attachments: const [],
      clientRequestId: clientRequestId,
    );

/// A ready client over a scripted bridge, and a controller for [sessionRef]
/// that attached and read an empty newest page.
final class SessionRig {
  SessionRig._(this.link, this.bridge, this.clock, this.client);

  static Future<SessionRig> start() async {
    final link = FakeContractLink();
    final bridge = ScriptedBridge(link);
    final clock = ManualClock();
    final client = ContractClient(
      link: link,
      info: () => const ClientInfo(name: 'test', version: '1'),
      clock: clock,
    );
    await pumpEventQueue();
    return SessionRig._(link, bridge, clock, client);
  }

  final FakeContractLink link;
  final ScriptedBridge bridge;
  final ManualClock clock;
  final ContractClient client;
  final handoff = PromptHandoff();
  var _ids = 0;

  /// A controller attached by the default handlers: a snapshot at seq 0,
  /// an empty history, the [summary] row.
  Future<SessionController> attached({SessionSnapshot? snapshot}) async {
    bridge.on<SessionAttachRequest>(
      (request) => snapshotAnswer(request, snapshot: snapshot),
    );
    bridge.on<TranscriptReadRequest>((request) => pageAnswer(request, []));
    bridge.on<SessionGetRequest>(
      (request) => SessionGetResponse(
        requestId: request.requestId,
        result: const SessionFound(summary: summary),
      ),
    );
    return controller();
  }

  /// A controller for [session] over whatever handlers the test set.
  Future<SessionController> controller({
    SessionRef session = sessionRef,
  }) async {
    final controller = SessionController(
      client: client,
      ref: session,
      clock: clock,
      handoff: handoff,
      newPromptId: () =>
          '00000000-0000-4000-8000-${(++_ids).toString().padLeft(12, '0')}',
    );
    await pumpEventQueue();
    return controller;
  }

  void dispose() => client.dispose();
}
