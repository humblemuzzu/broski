import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_reply.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/outcomes.dart';
import 'package:broski/contract/generated/contract.dart';

/// Attaching to a session and controlling it (contract §8, §9, §10, §12.2).
extension LiveRequests on ContractClient {
  Future<ContractReply<SessionAttachResponse>> attach(
    SessionRef session, {
    StreamPosition? resume,
  }) => request<SessionAttachResponse>(
    (requestId) => SessionAttachRequest(
      requestId: requestId,
      session: session,
      resume: resume,
    ),
  );

  Future<ContractReply<SessionDetachResponse>> detach(SessionRef session) =>
      request<SessionDetachResponse>(
        (requestId) =>
            SessionDetachRequest(requestId: requestId, session: session),
      );

  Future<Outcome<PromptAccepted>> prompt(
    SessionRef session,
    PromptInput input,
  ) async => outcomeOf(
    await request<PromptResponse>(
      (requestId) =>
          PromptRequest(requestId: requestId, session: session, input: input),
    ),
    (response) => switch (response.result) {
      final PromptAccepted accepted => Done(accepted),
      Rejected(:final rejection) => Refused(rejection),
    },
  );

  Future<Outcome<ActionAccepted>> abort(SessionRef session) async => outcomeOf(
    await request<AbortResponse>(
      (requestId) => AbortRequest(requestId: requestId, session: session),
    ),
    (response) => actionOutcome(response.result),
  );

  Future<Outcome<ActionAccepted>> cancelCompaction(SessionRef session) async =>
      outcomeOf(
        await request<CompactionCancelResponse>(
          (requestId) =>
              CompactionCancelRequest(requestId: requestId, session: session),
        ),
        (response) => actionOutcome(response.result),
      );

  Future<Outcome<ActionAccepted>> cancelRetry(SessionRef session) async =>
      outcomeOf(
        await request<RetryCancelResponse>(
          (requestId) =>
              RetryCancelRequest(requestId: requestId, session: session),
        ),
        (response) => actionOutcome(response.result),
      );

  Future<Outcome<ActionAccepted>> answer(
    SessionRef session,
    InteractionAnswer answer,
  ) async => outcomeOf(
    await request<InteractionAnswerResponse>(
      (requestId) => InteractionAnswerRequest(
        requestId: requestId,
        session: session,
        answer: answer,
      ),
    ),
    (response) => actionOutcome(response.result),
  );

  Future<Outcome<ActionAccepted>> cancelQueued(
    SessionRef session,
    QueueItemId queueItemId,
  ) async => outcomeOf(
    await request<QueueCancelResponse>(
      (requestId) => QueueCancelRequest(
        requestId: requestId,
        session: session,
        queueItemId: queueItemId,
      ),
    ),
    (response) => actionOutcome(response.result),
  );

  Future<Outcome<ActionAccepted>> setModel(
    SessionRef session,
    ModelId modelId,
  ) async => outcomeOf(
    await request<ModelSetResponse>(
      (requestId) => ModelSetRequest(
        requestId: requestId,
        session: session,
        modelId: modelId,
      ),
    ),
    (response) => actionOutcome(response.result),
  );

  Future<Outcome<ActionAccepted>> setThinking(
    SessionRef session,
    String thinking,
  ) async => outcomeOf(
    await request<ThinkingSetResponse>(
      (requestId) => ThinkingSetRequest(
        requestId: requestId,
        session: session,
        thinking: thinking,
      ),
    ),
    (response) => actionOutcome(response.result),
  );

  Future<Outcome<ActionAccepted>> setMode(
    SessionRef session,
    ModeAxisId axis,
    String value,
  ) async => outcomeOf(
    await request<ModeSetResponse>(
      (requestId) => ModeSetRequest(
        requestId: requestId,
        session: session,
        axis: axis,
        value: value,
      ),
    ),
    (response) => actionOutcome(response.result),
  );

  Future<Outcome<ActionAccepted>> compact(
    SessionRef session, {
    String? instructions,
  }) async => outcomeOf(
    await request<CompactResponse>(
      (requestId) => CompactRequest(
        requestId: requestId,
        session: session,
        instructions: instructions,
      ),
    ),
    (response) => actionOutcome(response.result),
  );
}
