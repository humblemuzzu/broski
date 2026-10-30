import 'package:broski/agent/ui/panels/op_inputs.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';

/// Where an operation is offered: on the session, or on one finished item of
/// its history.
enum OpPlace { session, item }

/// Which sessions an operation applies to, by what the session allows.
enum OpAudience {
  anySession,

  /// Only a session that cannot be driven from here yet
  /// (`SessionCapabilities.controllable` false).
  watchOnlySession,
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
}

/// Every operation kind the contract defines has exactly one panel, so a new
/// kind does not compile until it is given one.
OpPanel panelFor(BackendOpKind kind) => switch (kind) {
  BackendOpKind.rewindFiles => const OpPanel(
    kind: BackendOpKind.rewindFiles,
    label: 'Rewind files to here',
    place: OpPlace.item,
    ask: askRewindFiles,
  ),
  BackendOpKind.reviewStart => const OpPanel(
    kind: BackendOpKind.reviewStart,
    label: 'Start a review',
    place: OpPlace.session,
    ask: askReviewStart,
  ),
  BackendOpKind.revert => const OpPanel(
    kind: BackendOpKind.revert,
    label: 'Revert history from here',
    place: OpPlace.item,
    ask: askRevert,
  ),
  BackendOpKind.revertStage => const OpPanel(
    kind: BackendOpKind.revertStage,
    label: 'Stage a revert to before this',
    place: OpPlace.item,
    ask: askRevertStage,
  ),
  BackendOpKind.revertClear => const OpPanel(
    kind: BackendOpKind.revertClear,
    label: 'Undo the staged revert',
    place: OpPlace.session,
    ask: askRevertClear,
  ),
  BackendOpKind.revertCommit => const OpPanel(
    kind: BackendOpKind.revertCommit,
    label: 'Commit the staged revert',
    place: OpPlace.session,
    ask: askRevertCommit,
  ),
  BackendOpKind.navigateTree => const OpPanel(
    kind: BackendOpKind.navigateTree,
    label: 'Continue from here',
    place: OpPlace.item,
    ask: askNavigateTree,
  ),
  BackendOpKind.takeOver => const OpPanel(
    kind: BackendOpKind.takeOver,
    label: 'Take over this session',
    place: OpPlace.session,
    audience: OpAudience.watchOnlySession,
    ask: askTakeOver,
  ),
};

/// The panels [capabilities] allow at [place], in the order declared. A panel
/// meant for a session that cannot be driven yet is left out when
/// [controllable] says this one can.
List<OpPanel> panelsAt(
  Capabilities capabilities,
  OpPlace place, {
  bool controllable = false,
}) => [
  for (final kind in capabilities.backendOps)
    if (panelFor(kind).place == place &&
        (panelFor(kind).audience == OpAudience.anySession || !controllable))
      panelFor(kind),
];
