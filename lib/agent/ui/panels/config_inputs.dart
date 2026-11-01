/// The calls of the configuration and list operations (contract 1.4). They
/// ask the person nothing: the call is the read, and what comes back carries
/// the controls for the next calls, which are built here too.
library;

import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/contract/generated/contract.dart';
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

Future<BackendCall?> askNewCustomTool(
  BuildContext context,
  OpTarget target,
) async => opCall(target.session, const CustomToolOp());

PluginsOp pluginsCall(OpTarget target, [ActionListChange? change]) => PluginsOp(
  cwd: projectOf(target),
  sessionId: _sessionOf(target),
  change: change,
);

/// The call that takes [change] on the list a result of [result]'s kind
/// shows; null for a list that is only read.
BackendCall Function(OpTarget target, ActionListChange change)? listChange(
  BackendOpResult result,
) => switch (result) {
  McpServersListed() => (target, change) => opCall(
    target.session,
    McpServersOp(sessionId: target.session.sessionId, change: change),
  ),
  PluginsListed() => (target, change) => opCall(
    target.session,
    pluginsCall(target, change),
  ),
  TasksListed() => (target, change) => opCall(
    target.session,
    TasksOp(sessionId: target.session.sessionId, change: change),
  ),
  CustomToolsListed() => (target, change) => opCall(
    target.session,
    CustomToolsOp(change: change),
  ),
  _ => null,
};

/// The call that reads, or changes then reads, the file [file] shows, for a
/// result of [result]'s kind.
BackendCall fileCall(
  OpTarget target,
  BackendOpResult result,
  EditableFile file, [
  EditableFileChange? change,
]) => switch (result) {
  CustomToolRead() => opCall(
    target.session,
    CustomToolOp(toolId: file.id, change: change),
  ),
  _ => opCall(
    target.session,
    ConfigFileOp(cwd: projectOf(target), fileId: file.id, change: change),
  ),
};
