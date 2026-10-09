import 'dart:async';

import 'package:broski/models/pi_bang_command.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi/pi_live_bash_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/services/pi_bridge_service.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Routes a Pi composer input that starts with `!` to `pi_execute_bash`.
///
/// Returns true when [text] was a `!`/`!!` command (dispatched, or dropped
/// because the body was empty), false when the caller should send it as a
/// normal prompt.
bool runPiBangCommand({
  required WidgetRef ref,
  required String text,
  required String? cwd,
}) {
  final parsed = parsePiBangCommand(text);
  if (parsed == null) return text.startsWith('!');

  final notifier = ref.read(chatSessionProvider.notifier);
  final sessionId = ref.read(chatSessionProvider).piSessionId ?? '';
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
  return true;
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
