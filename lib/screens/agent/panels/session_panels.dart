import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/op_inputs.dart';
import 'package:broski/screens/agent/panels/op_panel.dart';
import 'package:broski/screens/agent/panels/session_control_inputs.dart';

const takeOverPanel = OpPanel(
  kind: BackendOpKind.takeOver,
  label: 'Take over this session',
  place: OpPlace.session,
  audience: OpAudience.watchOnlySession,
  ask: askTakeOver,
);

const sessionSettingsPanel = OpPanel(
  kind: BackendOpKind.sessionSettings,
  label: 'Session settings',
  place: OpPlace.session,
  audience: OpAudience.controllableSession,
  ask: askSessionSettings,
);

const sessionToolsPanel = OpPanel(
  kind: BackendOpKind.sessionTools,
  label: 'Tools',
  place: OpPlace.session,
  audience: OpAudience.controllableSession,
  ask: askSessionTools,
);

const systemPromptPanel = OpPanel(
  kind: BackendOpKind.systemPrompt,
  label: 'System prompt',
  place: OpPlace.session,
  audience: OpAudience.controllableSession,
  ask: askSystemPrompt,
);
