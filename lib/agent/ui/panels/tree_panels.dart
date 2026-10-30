import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/ui/panels/op_inputs.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:broski/agent/ui/panels/tree/tree_panel.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';

/// The session tree, offered from the session's menu: it reads, and moves and
/// labels through calls of its own, so it asks nothing before it opens.
const treePanel = OpPanel(
  kind: BackendOpKind.readTree,
  label: 'Session tree',
  place: OpPlace.session,
  ask: askNothing,
  flow: _openTree,
);

Future<void> _openTree(
  BuildContext context,
  ContractClient client,
  SessionRef session,
  FileTransfers files,
) => showTreeSheet(context, session);

/// An operation a panel of its own calls (the tree's label and cancel, the
/// composer's shell command): it has no place in a menu.
OpPanel embeddedOp(BackendOpKind kind) => OpPanel(
  kind: kind,
  label: kind.wire,
  place: OpPlace.unlisted,
  ask: askNothing,
);
