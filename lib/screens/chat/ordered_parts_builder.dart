import 'package:broski/models/message.dart';
import 'package:broski/screens/chat/tool_card_builder.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/compact_agent_card.dart';
import 'package:broski/widgets/chat/message_group.dart';
import 'package:broski/widgets/message_bubble.dart';
import 'package:broski/widgets/retry_indicator.dart';
import 'package:flutter/material.dart';

/// Build widgets for ordered parts (Claude Code sequential rendering).
/// Returns widgets in arrival order: text segments and tool calls interleaved.
/// Extracted from `_ChatScreenState._buildOrderedParts`.
List<Widget> buildOrderedParts({
  required BuildContext context,
  required ChatMessage message,
  required bool isClaudeCode,
  required bool isOpenCode,
  required bool isCodex,
  required Widget Function(ToolCall tool, String messageId) buildToolCardFn,
  required void Function({String? messageId}) onFork,
  void Function(String messageId)? onResumeFromHere,
  void Function(String messageId)? onDeleteMessage,
  VoidCallback? onRollback,
  void Function(String messageId, String text)? onEditMessage,
}) {
  final widgets = <Widget>[];
  final toolsById = {for (final t in message.toolCalls) t.callId: t};
  for (final part in message.parts) {
    switch (part) {
      case TextPart(:final text, :final isStreaming):
        if (text.trim().isNotEmpty) {
          final textMessage = ChatMessage(
            id: '${message.id}-text-${part.sequence}',
            sessionId: message.sessionId,
            role: message.role,
            createdAt: message.createdAt,
            text: text,
            isStreaming: isStreaming,
          );
          widgets.add(
            Padding(
              padding: EdgeInsets.only(top: widgets.isEmpty ? 0 : 8),
              child: MessageBubble(
                message: textMessage,
                onForkFromHere: message.role == MessageRole.assistant
                    ? (_) => onFork(messageId: message.id)
                    : null,
                onResumeFromHere:
                    isClaudeCode && message.role == MessageRole.assistant
                    ? (_) => onResumeFromHere?.call(message.id)
                    : null,
                onDeleteMessage:
                    isOpenCode && message.role == MessageRole.assistant
                    ? (_) => onDeleteMessage?.call(message.id)
                    : null,
                onRollback: isCodex ? onRollback : null,
                onEditMessage: isCodex && message.role == MessageRole.user
                    ? onEditMessage
                    : null,
              ),
            ),
          );
        }
      case ToolPart(:final callId):
        final tool = toolsById[callId];
        if (tool != null) {
          widgets.add(
            Padding(
              padding: Insets.topSm,
              child: buildToolCardFn(tool, message.id),
            ),
          );
        }
      case SubtaskPart(:final agentName, :final description):
        widgets.add(
          Padding(
            padding: Insets.topSm,
            child: CompactAgentCard.fromNotification(
              notification: SubtaskNotification(
                id: 'subtask-${message.id}-${part.sequence}',
                description: description ?? '',
                agent: agentName,
                sessionId: message.sessionId,
              ),
              messageId: message.id,
            ),
          ),
        );
      case RetryPart(:final attempt, :final errorMessage):
        widgets.add(
          Padding(
            padding: Insets.topSm,
            child: RetryIndicator(
              retryInfo: RetryInfo(
                attempt: attempt,
                errorMessage: errorMessage,
              ),
            ),
          ),
        );
      case AgentIndicatorPart(:final agentName):
        widgets.add(
          Padding(
            padding: Insets.topSm,
            child: buildAgentPill(context, agentName),
          ),
        );
      case CompactionIndicatorPart(:final auto, :final overflow):
        widgets.add(
          buildCompactionDividerEnhanced(
            context,
            auto: auto,
            overflow: overflow,
          ),
        );
      case PatchIndicatorPart(:final files):
        widgets.add(
          Padding(padding: Insets.topSm, child: buildPatchCard(context, files)),
        );
      case SnapshotPart():
        break;
      case StepStartIndicatorPart():
        break;
      case StepFinishIndicatorPart():
        break;
    }
  }
  // Fallback: if no widgets were built from parts but message has content
  if (widgets.isEmpty) {
    if (message.text.trim().isNotEmpty) {
      widgets.add(
        MessageBubble(
          message: message,
          onForkFromHere: message.role == MessageRole.assistant
              ? (messageId) => onFork(messageId: message.id)
              : null,
          onResumeFromHere:
              isClaudeCode && message.role == MessageRole.assistant
              ? (messageId) => onResumeFromHere?.call(messageId)
              : null,
          onDeleteMessage: isOpenCode && message.role == MessageRole.assistant
              ? (_) => onDeleteMessage?.call(message.id)
              : null,
          onRollback: isCodex ? onRollback : null,
        ),
      );
    }
    for (final tool in message.toolCalls) {
      widgets.add(
        Padding(
          padding: Insets.topSm,
          child: buildToolCardFn(tool, message.id),
        ),
      );
    }
  }
  return widgets;
}
