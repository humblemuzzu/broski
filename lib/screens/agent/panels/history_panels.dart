import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/op_inputs.dart';
import 'package:broski/screens/agent/panels/op_panel.dart';

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
