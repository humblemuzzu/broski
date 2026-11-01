import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';

/// What can be done to a session row, offered exactly where the backend's
/// capabilities say it can be (contract §6: `fork`, `rename`, `delete`,
/// `archive` are derived from the adapter's methods, so they cannot lie).
enum RowAction { rename, fork, archive, unarchive, delete, children }

List<RowAction> rowActions(SessionSummary row, Capabilities capabilities) => [
  if (capabilities.rename) RowAction.rename,
  if (capabilities.fork) RowAction.fork,
  if (capabilities.archive && !row.archived) RowAction.archive,
  if (capabilities.archive && row.archived) RowAction.unarchive,
  if (capabilities.delete) RowAction.delete,
  if (capabilities.children) RowAction.children,
];

/// Runs the row actions that change a session. Rows change through the
/// catalog's `session_updated` and `session_removed`; a delete also takes
/// the row out of [list] at once.
final class SessionActions {
  const SessionActions(this._client);

  final ContractClient _client;

  Future<String?> rename(SessionRef session, String title) async =>
      problemOf(await _client.renameSession(session, title));

  Future<String?> setArchived(
    SessionRef session, {
    required bool archived,
  }) async =>
      problemOf(await _client.archiveSession(session, archived: archived));

  Future<String?> delete(SessionRef session, SessionListController list) async {
    final outcome = await _client.deleteSession(session);
    if (outcome is Done) list.removeRow(session);
    return problemOf(outcome);
  }

  Future<Outcome<SessionRef>> create(
    BackendId backend,
    NewSessionOptions options,
  ) => _client.createSession(backend, options);
}
