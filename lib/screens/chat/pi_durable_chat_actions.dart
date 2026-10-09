import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/models/pi_durable/pi_durable_payloads.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_durable/pi_durable_providers.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  final content = composePiDurablePrompt(text, attachedFiles);
  final images = piDurableImagesFromAttachments(attachedFiles);
  if (content.isEmpty && images.isEmpty) return false;
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
      images: images,
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
  required List<Map<String, dynamic>> images,
}) async {
  try {
    await ref
        .read(bridgeServiceProvider)
        .pdChat(
          sessionId: sessionId,
          content: content,
          requestId: requestId,
          steer: steer,
          images: images,
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

/// `pd_compact` for the durable session: the bridge admits a manual compaction
/// and the summary lands at the next turn boundary.
Future<void> pdCompactSession({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final sessionId = ref.read(chatSessionProvider).pdSessionId ?? '';
  if (sessionId.isEmpty) return;
  try {
    final admitted = await ref
        .read(bridgeServiceProvider)
        .pdCompact(sessionId: sessionId);
    if (!context.mounted) return;
    showInfo(
      context,
      admitted ? 'Compacting context' : 'Could not start compaction',
    );
  } catch (e) {
    if (context.mounted) {
      showError(context, 'Compact failed: ${humanizeError(e)}');
    }
  }
}

/// Copies the durable session id, the handle the bridge and the Mac share.
Future<void> pdCopySessionId({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final sessionId = ref.read(chatSessionProvider).pdSessionId ?? '';
  if (sessionId.isEmpty) return;
  await Clipboard.setData(ClipboardData(text: sessionId));
  if (context.mounted) showInfo(context, 'Session id copied');
}

/// Deletes the durable session from the Mac, then leaves the chat. Refused by
/// the bridge while the session has live work, so the confirm cannot lose it.
Future<void> pdDeleteSession({
  required BuildContext context,
  required WidgetRef ref,
}) async {
  final sessionId = ref.read(chatSessionProvider).pdSessionId ?? '';
  if (sessionId.isEmpty) return;
  final theme = OpenCodeTheme.of(context);
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      backgroundColor: Theme.of(dialogContext).colorScheme.surface,
      title: const Text('Delete Session?'),
      content: const Text(
        'The durable session and its transcript are removed from your Mac. '
        'This cannot be undone.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, false),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(dialogContext, true),
          child: Text('Delete', style: TextStyle(color: theme.error)),
        ),
      ],
    ),
  );
  if (confirmed != true) return;
  final deleted = await ref
      .read(bridgeServiceProvider)
      .unifiedDeleteSession(backend: AgentType.piDurable, sessionId: sessionId);
  if (!context.mounted) return;
  if (!deleted) {
    showError(context, 'Session is busy or could not be deleted');
    return;
  }
  ref.invalidate(piDurableSessionsProvider);
  Navigator.of(context).pop();
}
