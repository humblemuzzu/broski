import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/services/haptics_service.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Sends the initial prompt if present and conditions are met.
/// Extracted from `_ChatScreenState._maybeSendInitialPrompt` in `chat_screen.dart`.
///
/// Returns `true` if the initial prompt was consumed (either sent or skipped
/// because the session already has messages), `false` if it could not be sent
/// yet (e.g. not connected, no prompt).
bool maybeSendInitialPrompt({
  required WidgetRef ref,
  required String? initialPrompt,
  required bool alreadySent,
  required TextEditingController controller,
  required void Function(BridgeConnectionState, ChatSessionState) sendMessage,
}) {
  if (alreadySent) return true;
  final prompt = initialPrompt?.trim() ?? '';
  if (prompt.isEmpty) return false;
  final connection = ref.read(connectionProvider);
  if (!connection.isConnected) return false;
  final chatState = ref.read(chatSessionProvider);
  if (chatState.messages.isNotEmpty) return true;
  controller.text = prompt;
  sendMessage(connection, chatState);
  return true;
}

/// Sets the Claude Code "resume from here" message ID and shows a snackbar.
/// Extracted from `_ChatScreenState._setClaudeResumeFromHere` in `chat_screen.dart`.
void setClaudeResumeFromHere({
  required BuildContext context,
  required String messageId,
  required HapticsService haptics,
  required void Function(String?) onResumeIdChanged,
}) {
  if (messageId.isEmpty) return;
  haptics.lightImpact();
  onResumeIdChanged(messageId);
  showInfo(context, 'Claude will resume from this message on your next send.');
}
