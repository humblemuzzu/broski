import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';

/// Where an operation is offered: on the session, on one finished item of its
/// history, on the backend as a whole (it names no session: its panel is run
/// with a [SessionRef] whose session id is empty), beside the model choice, or
/// in no menu, because another panel or screen calls it (an export's later
/// parts, the tree's label and cancel, the composer's shell command).
enum OpPlace { session, item, backend, modelPicker, unlisted }

/// Which sessions an operation applies to, by what the session allows.
enum OpAudience {
  anySession,

  /// Only a session that cannot be driven from here yet
  /// (`SessionCapabilities.controllable` false).
  watchOnlySession,

  /// Only a session that can be driven from here
  /// (`SessionCapabilities.controllable` true).
  controllableSession,
}

/// A backend's own operation (contract §13, `backend.call`) as the generic
/// screens offer it. Screens ask the registry by capability, never by
/// backend: a panel is shown exactly when `backendOps` lists its kind.
final class OpPanel {
  const OpPanel({
    required this.kind,
    required this.label,
    required this.place,
    required this.ask,
    this.audience = OpAudience.anySession,
    this.flow,
  });

  final BackendOpKind kind;
  final String label;
  final OpPlace place;
  final OpAudience audience;

  /// Asks for what the call needs; null when the person cancels. [itemId]
  /// is set for an item operation.
  final Future<BackendCall?> Function(
    BuildContext context,
    SessionId sessionId,
    TranscriptItemId? itemId,
  )
  ask;

  /// For an operation that is more than one call, or a screen of its own: it
  /// runs instead of [ask] and the call, and shows its own outcome.
  final Future<void> Function(
    BuildContext context,
    ContractClient client,
    SessionRef session,
    FileTransfers files,
  )?
  flow;
}
