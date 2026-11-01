import 'package:broski/agent/ui/panels/op_inputs.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/contract/generated/contract.dart';

const rewindFilesPanel = OpPanel(
  kind: BackendOpKind.rewindFiles,
  label: 'Rewind files to here',
  place: OpPlace.item,
  ask: askRewindFiles,
);

const reviewStartPanel = OpPanel(
  kind: BackendOpKind.reviewStart,
  label: 'Start a review',
  place: OpPlace.session,
  ask: askReviewStart,
);

const revertPanel = OpPanel(
  kind: BackendOpKind.revert,
  label: 'Revert history from here',
  place: OpPlace.item,
  ask: askRevert,
);

const revertStagePanel = OpPanel(
  kind: BackendOpKind.revertStage,
  label: 'Stage a revert to before this',
  place: OpPlace.item,
  ask: askRevertStage,
);

const revertClearPanel = OpPanel(
  kind: BackendOpKind.revertClear,
  label: 'Undo the staged revert',
  place: OpPlace.session,
  ask: askRevertClear,
);

const revertCommitPanel = OpPanel(
  kind: BackendOpKind.revertCommit,
  label: 'Commit the staged revert',
  place: OpPlace.session,
  ask: askRevertCommit,
);

const navigateTreePanel = OpPanel(
  kind: BackendOpKind.navigateTree,
  label: 'Continue from here',
  place: OpPlace.item,
  ask: askNavigateTree,
);
