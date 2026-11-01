import 'package:broski/agent/ui/panels/config_panels.dart';
import 'package:broski/agent/ui/panels/file_panels.dart';
import 'package:broski/agent/ui/panels/history_panels.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/agent/ui/panels/session_panels.dart';
import 'package:broski/agent/ui/panels/tree_panels.dart';
import 'package:broski/contract/generated/contract.dart';

export 'package:broski/agent/ui/panels/op_panel.dart';

/// Every operation kind the contract defines has exactly one panel, so a new
/// kind does not compile until it is given one.
OpPanel panelFor(BackendOpKind kind) => switch (kind) {
  BackendOpKind.rewindFiles => rewindFilesPanel,
  BackendOpKind.navigateTree => navigateTreePanel,
  BackendOpKind.readTree => treePanel,
  BackendOpKind.labelEntry ||
  BackendOpKind.abortBranchSummary ||
  BackendOpKind.runShell => embeddedOp(kind),
  BackendOpKind.takeOver => takeOverPanel,
  BackendOpKind.sessionSettings => sessionSettingsPanel,
  BackendOpKind.sessionTools => sessionToolsPanel,
  BackendOpKind.systemPrompt => systemPromptPanel,
  BackendOpKind.exportSession => exportSessionPanel,
  BackendOpKind.exportPart => exportPartPanel,
  BackendOpKind.importSession => importSessionPanel,
  BackendOpKind.changedFiles => changedFilesPanel,
  BackendOpKind.refreshModels => refreshModelsPanel,
  BackendOpKind.configFiles => configFilesPanel,
  BackendOpKind.configFile => configFilePanel,
  BackendOpKind.settingsOverview => settingsOverviewPanel,
  BackendOpKind.mcpServers => mcpServersPanel,
  BackendOpKind.plugins => pluginsPanel,
  BackendOpKind.tasks => tasksPanel,
  BackendOpKind.contextUsage => contextUsagePanel,
  BackendOpKind.customTools => customToolsPanel,
  BackendOpKind.customTool => customToolPanel,
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
        _offered(panelFor(kind).audience, controllable))
      panelFor(kind),
];

bool _offered(OpAudience audience, bool controllable) => switch (audience) {
  OpAudience.anySession => true,
  OpAudience.watchOnlySession => !controllable,
  OpAudience.controllableSession => controllable,
};
