import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/pi_durable/pi_durable_payloads.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens a durable session: attaches the live stream, then hydrates the
/// transcript. `pd_get_transcript` resumes work the Mac left interrupted, so
/// this belongs on open — never on a poll.
Future<void> hydratePiDurableSession({
  required WidgetRef ref,
  required ChatScreen widget,
}) async {
  final chat = ref.read(chatSessionProvider.notifier);
  final sessionId = widget.session.id;
  chat.setPiDurableSession(sessionId: sessionId, cwd: widget.project.path);
  if (sessionId.isEmpty) return;
  try {
    final page = await ref
        .read(bridgeServiceProvider)
        .pdGetTranscript(sessionId: sessionId);
    chat.hydratePiDurableTranscript(page.messages);
  } catch (_) {
    // The live stream is already attached: a missing transcript is recoverable.
  }
}

/// Sends a prompt over `pd_chat`.
///
/// The optimistic message id is reused as the requestId, so a resend after a
/// reconnect is absorbed by the bridge's exactly-once key instead of appending
/// the prompt twice. While the session is streaming the prompt steers the
/// running turn.
bool sendPiDurableMessage({
  required WidgetRef ref,
  required String text,
  required List<FileAttachment> attachedFiles,
}) {
  final chatState = ref.read(chatSessionProvider);
  if (!chatState.isPiDurable) return false;
  final sessionId = chatState.pdSessionId ?? '';
  if (sessionId.isEmpty) return false;

  final content = piDurablePromptWithAttachments(text, attachedFiles);
  final messageId = piDurableClientMessageId();
  final steer = chatState.pdIsStreaming;
  final chat = ref.read(chatSessionProvider.notifier);
  chat.appendPiDurableUserMessage(content, messageId: messageId);
  chat.setPiDurableStreaming(true);
  unawaited(
    _submit(
      chat: chat,
      ref: ref,
      sessionId: sessionId,
      content: content,
      requestId: messageId,
      steer: steer,
    ),
  );
  return true;
}

Future<void> _submit({
  required ChatSessionNotifier chat,
  required WidgetRef ref,
  required String sessionId,
  required String content,
  required String requestId,
  required bool steer,
}) async {
  try {
    await ref
        .read(bridgeServiceProvider)
        .pdChat(
          sessionId: sessionId,
          content: content,
          requestId: requestId,
          steer: steer,
        );
  } catch (_) {
    // The prompt never reached the Mac: stop pretending the turn is running so
    // the next send starts a turn instead of steering a dead one.
    if (chat.mounted) chat.setPiDurableStreaming(false);
  }
}

/// `unified_abort` for the durable session. The streaming flag is cleared here
/// rather than on the abort reply, which is not the turn-end signal.
bool stopPiDurableGeneration(WidgetRef ref) {
  final chatState = ref.read(chatSessionProvider);
  if (!chatState.isPiDurable) return false;
  final sessionId = chatState.pdSessionId ?? '';
  ref.read(chatSessionProvider.notifier).setPiDurableStreaming(false);
  if (sessionId.isEmpty) return true;
  unawaited(
    ref
        .read(bridgeServiceProvider)
        .unifiedAbort(backend: AgentType.piDurable, sessionId: sessionId)
        .catchError((Object _) => false),
  );
  return true;
}

/// `pd_chat` carries text only, so attachments travel as their display paths.
String piDurablePromptWithAttachments(
  String text,
  List<FileAttachment> attachedFiles,
) {
  if (attachedFiles.isEmpty) return text;
  final labels = <String>[];
  var imageCount = 0;
  for (final file in attachedFiles) {
    if (file.isImage) {
      imageCount++;
      labels.add('[Image $imageCount]');
    } else {
      labels.add(file.displayPath);
    }
  }
  return labels.isEmpty ? text : '$text\n${labels.join(' ')}';
}
