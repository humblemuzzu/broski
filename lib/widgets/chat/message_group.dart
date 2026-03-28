import 'package:broski/models/message.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat/oc_message_delete_action.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/cc_undo_turn_bar.dart';
import 'package:broski/widgets/chat/compact_agent_card.dart';
import 'package:broski/widgets/chat/compact_thinking_card.dart';
import 'package:broski/widgets/chat/message_helpers.dart';
import 'package:broski/widgets/diff_viewer.dart';
import 'package:broski/widgets/message_bubble.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// ── Public helper ──────────────────────────────────────────────────────────

/// Enhanced compaction divider with auto/manual/overflow indicator.
/// Public so _buildOrderedParts in chat_screen.dart can also use it.
Widget buildCompactionDividerEnhanced(
  BuildContext context, {
  required bool auto,
  bool overflow = false,
}) {
  final theme = OpenCodeTheme.of(context);
  final label = overflow
      ? 'Context compacted (overflow)'
      : (auto ? 'Context compacted (auto)' : 'Context compacted');
  return Padding(
    padding: Insets.screenV,
    child: Row(
      children: [
        Expanded(
          child: Divider(
            color: theme.textMuted.withValues(alpha: 0.3),
            thickness: 1,
          ),
        ),
        Padding(
          padding: Insets.cardH,
          child: Text(
            label,
            style: TextStyle(
              color: theme.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
        Expanded(
          child: Divider(
            color: theme.textMuted.withValues(alpha: 0.3),
            thickness: 1,
          ),
        ),
      ],
    ),
  );
}

// ── MessageGroup widget ────────────────────────────────────────────────────

/// Renders a single message group in the chat list.
///
/// Handles compaction dividers, context overflow, variant-tagged system
/// messages, reasoning blocks, message bubbles, tool calls, diffs,
/// subtask notifications, and the Claude Code undo bar.
///
/// Extracted from chat_screen.dart `_buildMessageGroup`.
class MessageGroup extends ConsumerWidget {
  const MessageGroup({
    super.key,
    required this.message,
    required this.isClaudeCode,
    required this.isOpenCode,
    required this.isCodex,
    required this.projectPath,
    // Action callbacks
    required this.onFork,
    required this.onResumeFromHere,
    required this.onRevert,
    required this.onOpenDiffView,
    required this.onCcRewind,
    required this.onCodexRollback,
    // Builder callbacks for complex sub-widgets that remain in chat_screen
    required this.buildVariantCard,
    required this.buildOrderedParts,
    required this.buildToolCard,
  });

  final ChatMessage message;
  final bool isClaudeCode;
  final bool isOpenCode;
  final bool isCodex;
  final String projectPath;

  /// Called when the user taps "Fork from here" on a message.
  final void Function({String? messageId}) onFork;

  /// Called when the user taps "Resume from here" (Claude Code).
  final void Function(String messageId) onResumeFromHere;

  /// Called to revert/undo a message or part.
  final void Function(String messageId, {String? partId}) onRevert;

  /// Called to open the full diff view.
  final void Function(DiffEntry diff, {String? messageId}) onOpenDiffView;

  /// Called to rewind to the last checkpoint (Claude Code turn-level undo).
  final VoidCallback onCcRewind;

  /// Called to show the Codex rollback sheet.
  final VoidCallback onCodexRollback;

  /// Builds a variant-tagged system message card. Returns null if unrecognized.
  final Widget? Function(ChatMessage) buildVariantCard;

  /// Builds the ordered parts view (Claude Code interleaved rendering).
  final List<Widget> Function(ChatMessage) buildOrderedParts;

  /// Builds a compact card for a single tool call.
  final Widget Function(ToolCall, String) buildToolCard;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Compaction marker → centered divider
    if (message.error == 'context_compacted') {
      return _buildCompactionDivider(context);
    }
    if (message.error == 'context_compacted_overflow') {
      return buildCompactionDividerEnhanced(
        context,
        auto: true,
        overflow: true,
      );
    }
    // Context overflow → action buttons
    if (message.error == 'ContextOverflowError') {
      return _buildContextOverflowError(context, ref);
    }
    // Variant-tagged system messages → compact cards
    if (message.role == MessageRole.system && message.variant != null) {
      final card = buildVariantCard(message);
      if (card != null) {
        return Padding(
          padding: const EdgeInsets.only(bottom: Spacing.sm),
          child: card,
        );
      }
    }

    // PERF: RepaintBoundary isolates this message's painting from others.
    return RepaintBoundary(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Reasoning/thinking content
          if (message.hasReasoning)
            Padding(
              padding: Insets.bottomSm,
              child: CompactThinkingCard(message: message),
            ),
          // Claude Code ordered parts vs fixed order
          if (message.hasOrderedParts)
            ...buildOrderedParts(message)
          else ...[
            if (message.text.trim().isNotEmpty || message.isStreaming)
              MessageBubble(
                message: message,
                onForkFromHere: message.role == MessageRole.assistant
                    ? (messageId) => onFork(messageId: messageId)
                    : null,
                onResumeFromHere:
                    isClaudeCode && message.role == MessageRole.assistant
                    ? (messageId) => onResumeFromHere(messageId)
                    : null,
                onDeleteMessage:
                    isOpenCode && message.role == MessageRole.assistant
                    ? (messageId) => deleteOpenCodeMessageFromChat(
                        context: context,
                        ref: ref,
                        sessionId: message.sessionId,
                        messageId: messageId,
                        projectPath:
                            ref.read(chatSessionProvider).projectPath ??
                            projectPath,
                      )
                    : null,
                onRollback: isCodex ? onCodexRollback : null,
              ),
            // Tool calls
            for (final tool in message.toolCalls)
              Padding(
                padding: Insets.topSm,
                child: buildToolCard(tool, message.id),
              ),
          ],
          // Diffs — only standalone diffs not already shown in edit cards
          for (final diff in message.diffs)
            if (!isDiffFromEditTool(diff, message.toolCalls))
              Padding(
                padding: Insets.topSm,
                child: DiffViewer(
                  diff: diff,
                  messageId: message.id,
                  onUndo: isClaudeCode
                      ? null
                      : (messageId, partId) =>
                            onRevert(messageId, partId: partId),
                  onViewFull: () => onOpenDiffView(diff, messageId: message.id),
                ),
              ),
          // Subtask notifications
          for (final subtask in message.subtaskNotifications)
            Padding(
              padding: Insets.topSm,
              child: CompactAgentCard.fromNotification(notification: subtask),
            ),
          // Claude Code: Turn-level undo bar after assistant messages with
          // file changes. Uses the SDK's rewindFiles(userMessageId).
          if (isClaudeCode &&
              message.role == MessageRole.assistant &&
              !message.isStreaming &&
              messageHasFileChanges(message))
            Builder(
              builder: (context) {
                final ccState = ref.watch(ccChatProvider);
                if (!ccState.canUndo) return const SizedBox.shrink();
                return CCUndoTurnBar(
                  changedFiles: extractChangedFilePaths(message),
                  onUndo: onCcRewind,
                );
              },
            ),
          const SizedBox(height: Spacing.lg),
        ],
      ),
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /// Simple compaction divider.
  Widget _buildCompactionDivider(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.screenV,
      child: Row(
        children: [
          Expanded(
            child: Divider(
              color: theme.textMuted.withValues(alpha: 0.3),
              thickness: 1,
            ),
          ),
          Padding(
            padding: Insets.cardH,
            child: Text(
              'Context compacted',
              style: TextStyle(
                color: theme.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          Expanded(
            child: Divider(
              color: theme.textMuted.withValues(alpha: 0.3),
              thickness: 1,
            ),
          ),
        ],
      ),
    );
  }

  /// Context overflow error with compact action button.
  Widget _buildContextOverflowError(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.screenV,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.warning.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: theme.warning.withValues(alpha: 0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '⚠️ ${message.text}',
              style: TextStyle(
                color: theme.warning,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton.icon(
                  onPressed: () {
                    final bridge = ref.read(bridgeServiceProvider);
                    final chatState = ref.read(chatSessionProvider);
                    final sessionId = chatState.session?.id;
                    if (sessionId != null) {
                      bridge.executeCommand(
                        sessionId: sessionId,
                        command: 'compact',
                        arguments: '',
                        projectPath: chatState.projectPath,
                      );
                    }
                  },
                  icon: Icon(Icons.compress, size: 16, color: theme.accent),
                  label: Text(
                    'Compact',
                    style: TextStyle(color: theme.accent, fontSize: 12),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
