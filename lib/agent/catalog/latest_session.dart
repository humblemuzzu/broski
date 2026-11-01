import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';

/// The session updated last of those working in [cwd], or null when there is
/// none: the first row of the backend's own list for that directory, which
/// is newest first (contract §11.1), so no rows past it are read.
Future<Outcome<SessionRef?>> latestSessionIn(
  ContractClient client,
  BackendId backend,
  String cwd,
) async {
  final outcome = await client.listSessions(
    backend,
    SessionQuery(cwd: cwd, archived: false),
    const PageRequest(limit: 1),
  );
  return switch (outcome) {
    Done(:final value) => Done(value.items.firstOrNull?.session),
    Refused(:final rejection) => Refused(rejection),
    Unreached(:final failure) => Unreached(failure),
  };
}
