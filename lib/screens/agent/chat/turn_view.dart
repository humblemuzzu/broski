import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart';
import 'package:broski/screens/agent/chat/chat_rows.dart';
import 'package:broski/screens/agent/chat/tool_call_view.dart';
import 'package:broski/screens/chat/session_actions.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/message_group.dart';
import 'package:broski/widgets/message_bubble.dart';
import 'package:flutter/material.dart';

/// One turn of the agent, drawn exactly as the app draws a message: the
/// thinking card, then its text and tool cards in the order they came.
class TurnView extends StatelessWidget {
  const TurnView({super.key, required this.session, required this.row});

  final SessionRef session;
  final TurnRow row;

  Widget _tool(ToolCall tool, String messageId) => ToolCallView(
    session: session,
    tool: tool,
    messageId: messageId,
    entry: row.tools[tool.callId],
  );

  @override
  Widget build(BuildContext context) => MessageGroup(
    message: row.message,
    onFork: ({String? messageId}) {},
    onResumeFromHere: (_) {},
    onOpenDiffView: (diff, {String? messageId}) =>
        openDiffView(context: context, diff: diff, messageId: messageId),
    buildVariantCard: (_) => null,
    buildOrderedParts: (message) => _orderedParts(message, _tool),
    buildToolCard: _tool,
  );
}

/// The turn's text segments and tool cards in arrival order. Unlike the old
/// chat's builder, a bubble here takes no long-press of its own: the row's
/// actions ("from here") belong to the chat.
List<Widget> _orderedParts(
  ChatMessage message,
  Widget Function(ToolCall tool, String messageId) tool,
) {
  final calls = {for (final call in message.toolCalls) call.callId: call};
  return [
    for (final part in message.parts)
      switch (part) {
        TextPart(:final text, :final isStreaming, :final sequence)
            when text.trim().isNotEmpty || isStreaming =>
          Padding(
            padding: EdgeInsets.only(top: sequence == 0 ? 0 : Spacing.sm),
            child: MessageBubble(
              message: ChatMessage(
                id: '${message.id}-text-$sequence',
                sessionId: message.sessionId,
                role: MessageRole.assistant,
                createdAt: message.createdAt,
                text: text,
                isStreaming: isStreaming,
              ),
            ),
          ),
        ToolPart(:final callId) when calls[callId] != null => Padding(
          padding: Insets.topSm,
          child: tool(calls[callId]!, message.id),
        ),
        _ => const SizedBox.shrink(),
      },
  ];
}
