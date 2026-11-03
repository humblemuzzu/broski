/// The calls of the configuration and list operations (contract 1.4). They
/// ask the person nothing: the call is the read, and what comes back carries
/// the controls for the next calls, which are built here too.
library;

import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/action_list_view.dart';
import 'package:broski/screens/agent/panels/op_panel.dart';
import 'package:flutter/material.dart';

/// The project a configuration call names. These panels are offered only
/// where the directory is known (`OpPlace.project`); the bridge refuses an
/// empty one.
String projectOf(OpTarget target) => target.cwd ?? '';

SessionId? _sessionOf(OpTarget target) =>
    target.session.sessionId.isEmpty ? null : target.session.sessionId;

Future<BackendCall?> askConfigFiles(
  BuildContext context,
  OpTarget target,
) async => target.cwd == null
    ? null
    : opCall(target.session, ConfigFilesOp(cwd: projectOf(target)));

Future<BackendCall?> askSettingsOverview(
  BuildContext context,
  OpTarget target,
) async => target.cwd == null
    ? null
    : opCall(target.session, SettingsOverviewOp(cwd: projectOf(target)));

Future<BackendCall?> askPlugins(BuildContext context, OpTarget target) async =>
    target.cwd == null ? null : opCall(target.session, pluginsCall(target));

Future<BackendCall?> askMcpServers(
  BuildContext context,
  OpTarget target,
) async =>
    opCall(target.session, McpServersOp(sessionId: target.session.sessionId));

Future<BackendCall?> askTasks(BuildContext context, OpTarget target) async =>
    opCall(target.session, TasksOp(sessionId: target.session.sessionId));

Future<BackendCall?> askContextUsage(
  BuildContext context,
  OpTarget target,
) async =>
    opCall(target.session, ContextUsageOp(sessionId: target.session.sessionId));

Future<BackendCall?> askCustomTools(
  BuildContext context,
  OpTarget target,
) async => opCall(target.session, const CustomToolsOp());

PluginsOp pluginsCall(OpTarget target, [ActionListChange? change]) => PluginsOp(
  cwd: projectOf(target),
  sessionId: _sessionOf(target),
  change: change,
);

/// The calls of a list result: the read that gives it again, and the call
/// that takes an action on one of its rows (null for a list that offers
/// none).
typedef ListCalls = ({
  BackendCall Function(OpTarget target) read,
  ListActionCall? change,
});

/// The calls of the list a result of [result]'s kind shows; null for a result
/// that is not a list.
ListCalls? listCallsOf(BackendOpResult result) => switch (result) {
  SettingsOverviewRead() => (
    read: (target) =>
        opCall(target.session, SettingsOverviewOp(cwd: projectOf(target))),
    change: null,
  ),
  ContextUsageRead() => (
    read: (target) => opCall(
      target.session,
      ContextUsageOp(sessionId: target.session.sessionId),
    ),
    change: null,
  ),
  McpServersListed() => (
    read: (target) => opCall(
      target.session,
      McpServersOp(sessionId: target.session.sessionId),
    ),
    change: (target, change) => opCall(
      target.session,
      McpServersOp(sessionId: target.session.sessionId, change: change),
    ),
  ),
  PluginsListed() => (
    read: (target) => opCall(target.session, pluginsCall(target)),
    change: (target, change) =>
        opCall(target.session, pluginsCall(target, change)),
  ),
  TasksListed() => (
    read: (target) =>
        opCall(target.session, TasksOp(sessionId: target.session.sessionId)),
    change: (target, change) => opCall(
      target.session,
      TasksOp(sessionId: target.session.sessionId, change: change),
    ),
  ),
  CustomToolsListed() => (
    read: (target) => opCall(target.session, const CustomToolsOp()),
    change: (target, change) =>
        opCall(target.session, CustomToolsOp(change: change)),
  ),
  _ => null,
};

/// The file a result carries, when it carries one.
EditableFile? fileOf(BackendOpResult result) => switch (result) {
  ConfigFileRead(:final file) || CustomToolRead(:final file) => file,
  _ => null,
};

/// The call that reads, or changes then reads, a configuration file.
BackendCall configFileCall(
  OpTarget target,
  EditableFile file,
  EditableFileChange? change,
) => opCall(
  target.session,
  ConfigFileOp(cwd: projectOf(target), fileId: file.id, change: change),
);

/// The same for the definition of one of the bridge's own tools.
BackendCall customToolCall(
  OpTarget target,
  EditableFile file,
  EditableFileChange? change,
) => opCall(target.session, CustomToolOp(toolId: file.id, change: change));
