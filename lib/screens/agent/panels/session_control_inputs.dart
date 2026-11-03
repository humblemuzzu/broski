/// The panels that read a session's own settings, tools and system prompt ask
/// the person nothing: the call is the read, and what comes back carries the
/// controls for the next calls.
library;

import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/op_panel.dart';
import 'package:flutter/material.dart';

Future<BackendCall?> askSessionSettings(
  BuildContext context,
  OpTarget target,
) async => opCall(
  target.session,
  SessionSettingsOp(sessionId: target.session.sessionId),
);

Future<BackendCall?> askSessionTools(
  BuildContext context,
  OpTarget target,
) async =>
    opCall(target.session, SessionToolsOp(sessionId: target.session.sessionId));

Future<BackendCall?> askSystemPrompt(
  BuildContext context,
  OpTarget target,
) async =>
    opCall(target.session, SystemPromptOp(sessionId: target.session.sessionId));
