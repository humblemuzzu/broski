import 'package:broski/agent/ui/panels/op_inputs.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/contract/generated/contract.dart';

const rewindFilesPanel = OpPanel(
  kind: BackendOpKind.rewindFiles,
  label: 'Rewind files to here',
  place: OpPlace.item,
  ask: askRewindFiles,
);

const navigateTreePanel = OpPanel(
  kind: BackendOpKind.navigateTree,
  label: 'Continue from here',
  place: OpPlace.item,
  ask: askNavigateTree,
);
