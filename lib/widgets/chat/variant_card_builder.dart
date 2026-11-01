import 'package:broski/models/message.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/cc_system_message_cards.dart';
import 'package:broski/widgets/chat/compact_hook_card.dart';
import 'package:broski/widgets/chat/compact_task_notification_card.dart';
import 'package:broski/widgets/chat/compact_tool_summary_chip.dart';
import 'package:broski/widgets/chat/files_persisted_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Builds a compact card widget for variant-tagged system messages.
/// Returns null if the variant is not recognized (falls through to default rendering).
///
/// Extracted from `_ChatScreenState._buildVariantCard` in `chat_screen.dart`.
Widget? buildVariantCard({
  required BuildContext context,
  required WidgetRef ref,
  required ChatMessage message,
}) {
  final variant = message.variant!;

  // Task notification: variant = 'task-notification:completed' etc.
  if (variant.startsWith('task-notification:')) {
    final status = variant.replaceFirst('task-notification:', '');
    // Extract taskId from message id (pattern: cc-task-{taskId}-{timestamp})
    final idParts = message.id.split('-');
    final taskId = idParts.length >= 3 ? idParts[2] : '';
    return CompactTaskNotificationCard(
      taskId: taskId,
      status: status,
      summary: message.text.replaceFirst(RegExp(r'^[✅❌⏳]\s*Task:\s*'), ''),
      onStop: status != 'completed' && status != 'failed' && status != 'stopped'
          ? () {
              final ccState = ref.read(ccChatProvider);
              final sessionId = ccState.sessionId;
              if (sessionId != null &&
                  sessionId.isNotEmpty &&
                  taskId.isNotEmpty) {
                ref
                    .read(bridgeServiceProvider)
                    .ccStopTask(sessionId: sessionId, taskId: taskId);
              }
            }
          : null,
    );
  }

  // Tool use summary: variant = 'tool-use-summary'
  if (variant == 'tool-use-summary') {
    return CompactToolSummaryChip(summary: message.text);
  }

  // Files persisted: variant = 'files-persisted'
  if (variant == 'files-persisted') {
    return FilesPersistedCard(message: message);
  }

  // Hook events: variant = 'hook:running' or 'hook:success' etc.
  if (variant.startsWith('hook:')) {
    final status = variant.replaceFirst('hook:', '');
    // Parse hook info from text: "⚡ Hook: {name} ({event})" or "⚡ Hook: {name} ({event}) — {outcome}"
    final hookText = message.text.replaceFirst(RegExp(r'^⚡\s*Hook:\s*'), '');
    final match = RegExp(r'^(.+?)\s*\(([^)]+)\)').firstMatch(hookText);
    final hookName = match?.group(1) ?? hookText;
    final hookEvent = match?.group(2) ?? '';
    // Check for output after " — "
    final dashIdx = hookText.indexOf(' — ');
    final output = dashIdx > 0 ? hookText.substring(dashIdx + 3) : null;
    return CompactHookCard(
      hookName: hookName,
      hookEvent: hookEvent,
      status: status,
      output: output,
    );
  }

  // Status compacting: variant = 'status-compacting'
  if (variant == 'status-compacting') {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.accent.withValues(alpha: 0.2),
          width: 0.5,
        ),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 14,
            height: 14,
            child: CircularProgressIndicator(
              strokeWidth: 1.5,
              color: theme.accent,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Compacting conversation…',
              style: TextStyle(fontSize: 12, color: theme.textMuted),
            ),
          ),
        ],
      ),
    );
  }

  // Assistant error: variant = 'assistant-error:{errorType}'
  if (variant.startsWith('assistant-error:')) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: theme.error.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: theme.error.withValues(alpha: 0.3),
          width: 0.5,
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.warning_amber_rounded, size: 16, color: theme.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message.text,
              style: TextStyle(fontSize: 12, color: theme.text, height: 1.3),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  // Auth status: variant = 'auth-status'
  if (variant == 'auth-status') {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 3),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: theme.accent.withValues(alpha: 0.2),
          width: 0.5,
        ),
      ),
      child: Row(
        children: [
          Icon(Icons.vpn_key_rounded, size: 14, color: theme.accent),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              message.text,
              style: TextStyle(fontSize: 12, color: theme.textMuted),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  // CC terminal reason: variant = 'cc-terminal:tool_deferred' etc.
  if (variant.startsWith('cc-terminal:')) {
    final reason = variant.replaceFirst('cc-terminal:', '');
    final isDeferred = reason == 'tool_deferred';
    return CompactTaskNotificationCard(
      taskId: message.id,
      status: isDeferred ? 'stopped' : 'failed',
      summary: message.text.replaceFirst(RegExp(r'^[⛔⚠️🛑🚫⏸️✅]\s*'), ''),
    );
  }

  final ccSystemCard = buildCcSystemMessageCard(
    context: context,
    message: message,
    variant: variant,
  );
  if (ccSystemCard != null) {
    return ccSystemCard;
  }

  return null; // Unknown variant, fall through to default rendering
}
