import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/outcomes.dart';
import 'package:broski/contract/generated/contract.dart';

/// Session rows, their history, and what changes them (contract §11.1, §11.2,
/// §10 attachments, §13 ops).
extension SessionRequests on ContractClient {
  Future<Outcome<SessionPage>> listSessions(
    BackendId backend,
    SessionQuery query,
    PageRequest page,
  ) async => outcomeOf(
    await request<SessionsListResponse>(
      (requestId) => SessionsListRequest(
        requestId: requestId,
        backend: backend,
        query: query,
        page: page,
      ),
    ),
    (response) => switch (response.result) {
      SessionsListed(:final page) => Done(page),
      Rejected(:final rejection) => Refused(rejection),
    },
  );

  Future<Outcome<SessionSummary>> getSession(SessionRef session) async =>
      outcomeOf(
        await request<SessionGetResponse>(
          (requestId) =>
              SessionGetRequest(requestId: requestId, session: session),
        ),
        (response) => switch (response.result) {
          SessionFound(:final summary) => Done(summary),
          Rejected(:final rejection) => Refused(rejection),
        },
      );

  Future<Outcome<SessionRef>> createSession(
    BackendId backend,
    NewSessionOptions options,
  ) async => outcomeOf(
    await request<SessionCreateResponse>(
      (requestId) => SessionCreateRequest(
        requestId: requestId,
        backend: backend,
        options: options,
      ),
    ),
    (response) => newSessionOutcome(response.result),
  );

  Future<Outcome<SessionRef>> forkSession(
    SessionRef session, {
    ForkPoint? at,
  }) async => outcomeOf(
    await request<SessionForkResponse>(
      (requestId) =>
          SessionForkRequest(requestId: requestId, session: session, at: at),
    ),
    (response) => newSessionOutcome(response.result),
  );

  Future<Outcome<ActionAccepted>> renameSession(
    SessionRef session,
    String title,
  ) async => outcomeOf(
    await request<SessionRenameResponse>(
      (requestId) => SessionRenameRequest(
        requestId: requestId,
        session: session,
        title: title,
      ),
    ),
    (response) => actionOutcome(response.result),
  );

  Future<Outcome<ActionAccepted>> deleteSession(SessionRef session) async =>
      outcomeOf(
        await request<SessionDeleteResponse>(
          (requestId) =>
              SessionDeleteRequest(requestId: requestId, session: session),
        ),
        (response) => actionOutcome(response.result),
      );

  Future<Outcome<ActionAccepted>> archiveSession(
    SessionRef session, {
    required bool archived,
  }) async => outcomeOf(
    await request<SessionArchiveResponse>(
      (requestId) => SessionArchiveRequest(
        requestId: requestId,
        session: session,
        archived: archived,
      ),
    ),
    (response) => actionOutcome(response.result),
  );

  Future<Outcome<TranscriptPage>> readTranscript(
    SessionRef session,
    PageRequest page,
  ) async => outcomeOf(
    await request<TranscriptReadResponse>(
      (requestId) => TranscriptReadRequest(
        requestId: requestId,
        session: session,
        page: page,
      ),
    ),
    (response) => switch (response.result) {
      TranscriptRead(:final page) => Done(page),
      Rejected(:final rejection) => Refused(rejection),
    },
  );

  Future<Outcome<ImageContent>> readAttachment(
    SessionRef session,
    AttachmentId attachmentId,
  ) async => outcomeOf(
    await request<AttachmentReadResponse>(
      (requestId) => AttachmentReadRequest(
        requestId: requestId,
        session: session,
        attachmentId: attachmentId,
      ),
    ),
    (response) => switch (response.result) {
      AttachmentRead(:final image) => Done(image),
      Rejected(:final rejection) => Refused(rejection),
    },
  );

  Future<Outcome<BackendOpResult>> callBackend(BackendCall call) async =>
      outcomeOf(
        await request<BackendCallResponse>(
          (requestId) => BackendCallRequest(requestId: requestId, call: call),
        ),
        (response) => switch (response.result) {
          BackendCallAccepted(:final result) => Done(result),
          Rejected(:final rejection) => Refused(rejection),
        },
      );
}
