import 'package:broski/agent/ui/panels/config_inputs.dart';
import 'package:broski/agent/ui/panels/op_inputs.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/contract/generated/contract.dart';

const configFilesPanel = OpPanel(
  kind: BackendOpKind.configFiles,
  label: 'Configuration files',
  place: OpPlace.project,
  ask: askConfigFiles,
);

const configFilePanel = OpPanel(
  kind: BackendOpKind.configFile,
  label: 'Configuration file',
  place: OpPlace.unlisted,
  ask: askNothing,
);

const settingsOverviewPanel = OpPanel(
  kind: BackendOpKind.settingsOverview,
  label: 'Settings in effect',
  place: OpPlace.project,
  ask: askSettingsOverview,
);

const pluginsPanel = OpPanel(
  kind: BackendOpKind.plugins,
  label: 'Plugins',
  place: OpPlace.project,
  ask: askPlugins,
);

const mcpServersPanel = OpPanel(
  kind: BackendOpKind.mcpServers,
  label: 'MCP servers',
  place: OpPlace.session,
  audience: OpAudience.controllableSession,
  ask: askMcpServers,
);

const tasksPanel = OpPanel(
  kind: BackendOpKind.tasks,
  label: 'Background tasks',
  place: OpPlace.session,
  audience: OpAudience.controllableSession,
  ask: askTasks,
);

const contextUsagePanel = OpPanel(
  kind: BackendOpKind.contextUsage,
  label: 'Context usage',
  place: OpPlace.session,
  audience: OpAudience.controllableSession,
  ask: askContextUsage,
);

const customToolsPanel = OpPanel(
  kind: BackendOpKind.customTools,
  label: 'Custom tools',
  place: OpPlace.backend,
  ask: askCustomTools,
);

const customToolPanel = OpPanel(
  kind: BackendOpKind.customTool,
  label: 'New custom tool',
  place: OpPlace.backend,
  ask: askNewCustomTool,
);
