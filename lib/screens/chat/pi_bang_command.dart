import 'dart:async';

import 'package:broski/models/message.dart';
import 'package:broski/models/pi_bang_command.dart';
import 'package:broski/models/pi_bash_card.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi/pi_live_bash_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What `runPiBangCommand` did with a composer input.
enum PiBangCommandOutcome { notBang, dispatched, blocked }

/// Whether a Pi `!` bash card for [sessionId] is still running.
bool hasRunningPiBashCommand(Iterable<ChatMessage> messages, String sessionId) {
  for (final message in messages) {
    if (message.sessionId != sessionId) continue;
    if (!isPiBashCard(message.metadata)) continue;
    if (message.metadata[PiBashCardKeys.status] == PiBashStatus.running) {
      return true;
    }
  }
  return false;
}

/// Routes a Pi composer input that starts with `!` to `pi_execute_bash`.
///
/// A bare `!` with an empty command body counts as
/// [PiBangCommandOutcome.dispatched]. A second command while one is still
/// running is refused as [PiBangCommandOutcome.blocked], mirroring pi's CLI.
PiBangCommandOutcome runPiBangCommand({
  required BuildContext context,
  required WidgetRef ref,
  required String text,
  required String? cwd,
}) {
  final parsed = parsePiBangCommand(text);
  if (parsed == null) {
    return text.startsWith('!')
        ? PiBangCommandOutcome.dispatched
        : PiBangCommandOutcome.notBang;
  }

  final notifier = ref.read(chatSessionProvider.notifier);
  final chatState = ref.read(chatSessionProvider);
  final sessionId = chatState.piSessionId ?? '';
  if (hasRunningPiBashCommand(chatState.messages, sessionId)) {
    showInfo(context, 'A bash command is already running');
    return PiBangCommandOutcome.blocked;
  }

  ref.read(piLiveBashProvider.notifier).clearSession(sessionId);
  final messageId = notifier.appendPiBashCommand(
    command: parsed.command,
    excludeFromContext: parsed.excludeFromContext,
    sessionId: sessionId,
  );

  unawaited(
    _execute(
      bridge: ref.read(piBridgeServiceProvider),
      notifier: notifier,
      messageId: messageId,
      command: parsed.command,
      excludeFromContext: parsed.excludeFromContext,
      cwd: cwd,
    ),
  );
  return PiBangCommandOutcome.dispatched;
}

Future<void> _execute({
  required PiBridgeService bridge,
  required ChatSessionNotifier notifier,
  required String messageId,
  required String command,
  required bool excludeFromContext,
  required String? cwd,
}) async {
  try {
    final result = await bridge.executeBash(
      command,
      excludeFromContext: excludeFromContext,
      projectPath: cwd,
    );
    notifier.completePiBashCommand(messageId: messageId, result: result);
  } catch (error) {
    notifier.failPiBashCommand(messageId: messageId, error: error.toString());
  }
}
