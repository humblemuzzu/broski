import 'package:broski/agent/ui/panels/op_inputs.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/agent/ui/panels/transfer/import_flow.dart';
import 'package:broski/contract/generated/contract.dart';

const exportSessionPanel = OpPanel(
  kind: BackendOpKind.exportSession,
  label: 'Export session',
  place: OpPlace.session,
  ask: askExportSession,
);

const exportPartPanel = OpPanel(
  kind: BackendOpKind.exportPart,
  label: 'Read an export',
  place: OpPlace.unlisted,
  ask: askNothing,
);

final importSessionPanel = OpPanel(
  kind: BackendOpKind.importSession,
  label: 'Import session file',
  place: OpPlace.backend,
  ask: askNothing,
  flow: (context, client, session, files) =>
      runImport(context, client, files, session.backend),
);

const changedFilesPanel = OpPanel(
  kind: BackendOpKind.changedFiles,
  label: 'Changed files',
  place: OpPlace.session,
  ask: askChangedFiles,
);

const refreshModelsPanel = OpPanel(
  kind: BackendOpKind.refreshModels,
  label: 'Refresh models',
  place: OpPlace.modelPicker,
  ask: askRefreshModels,
);
