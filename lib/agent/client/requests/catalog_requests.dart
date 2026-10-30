import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/bridge_minor.dart';
import 'package:broski/agent/client/requests/outcomes.dart';
import 'package:broski/contract/generated/contract.dart';

/// Backend-wide reads (contract §11.3, §11.4, §11.5).
extension CatalogRequests on ContractClient {
  Future<Outcome<List<BackendDescriptor>>> listBackends() async => outcomeOf(
    await request<BackendsListResponse>(
      (requestId) => BackendsListRequest(requestId: requestId),
    ),
    (response) => Done(response.backends),
  );

  Future<Outcome<BackendStatus>> backendStatus(BackendId backend) async =>
      outcomeOf(
        await request<BackendStatusResponse>(
          (requestId) =>
              BackendStatusRequest(requestId: requestId, backend: backend),
        ),
        (response) => Done(response.status),
      );

  /// With [includeUnavailable] the models the backend knows but cannot use
  /// now come too, each with its `unavailableReason`; asked only of a bridge
  /// that speaks the minor that added it (contract §12.4).
  Future<Outcome<List<ModelSummary>>> listModels(
    BackendId backend, {
    String? cwd,
    bool includeUnavailable = false,
  }) async => outcomeOf(
    await request<ModelsListResponse>(
      (requestId) => ModelsListRequest(
        requestId: requestId,
        backend: backend,
        cwd: cwd,
        includeUnavailable:
            includeUnavailable && bridgeSpeaks(minorWithUnavailableModels)
            ? true
            : null,
      ),
    ),
    (response) => switch (response.result) {
      ModelsListed(:final models) => Done(models),
      Rejected(:final rejection) => Refused(rejection),
    },
  );

  Future<Outcome<List<CommandSummary>>> listCommands(
    BackendId backend, {
    String? cwd,
    SessionRef? session,
  }) async => outcomeOf(
    await request<CommandsListResponse>(
      (requestId) => CommandsListRequest(
        requestId: requestId,
        backend: backend,
        cwd: cwd,
        session: session,
      ),
    ),
    (response) => switch (response.result) {
      CommandsListed(:final commands) => Done(commands),
      Rejected(:final rejection) => Refused(rejection),
    },
  );

  Future<Outcome<List<ModeAxis>>> listModes(
    BackendId backend, {
    String? cwd,
  }) async => outcomeOf(
    await request<ModesListResponse>(
      (requestId) =>
          ModesListRequest(requestId: requestId, backend: backend, cwd: cwd),
    ),
    (response) => switch (response.result) {
      ModesListed(:final modes) => Done(modes),
      Rejected(:final rejection) => Refused(rejection),
    },
  );
}
