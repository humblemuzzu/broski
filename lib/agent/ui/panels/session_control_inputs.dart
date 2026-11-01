/// The panels that read a session's own settings, tools and system prompt ask
/// the person nothing: the call is the read, and what comes back carries the
/// controls for the next calls.
library;

import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';

Future<BackendCall?> askSessionSettings(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async => opCall(SessionSettingsOp(sessionId: sessionId));

Future<BackendCall?> askSessionTools(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async => opCall(SessionToolsOp(sessionId: sessionId));

Future<BackendCall?> askSystemPrompt(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async => opCall(SystemPromptOp(sessionId: sessionId));
