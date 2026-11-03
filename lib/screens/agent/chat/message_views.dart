import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart';
import 'package:broski/screens/agent/chat/attachment_view.dart';
import 'package:broski/screens/agent/chat/turn_markers.dart';
import 'package:broski/screens/agent/shared/status_look.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/message_group.dart';
import 'package:broski/widgets/message_bubble.dart';
import 'package:flutter/material.dart';

/// A message of the chat that is only text: what a person wrote, or a run
/// that failed, drawn by the app's own bubble.
ChatMessage chatMessage({
  required String id,
  required MessageRole role,
  required String text,
  String? error,
  String? delivery,
}) => ChatMessage(
  id: id,
  sessionId: '',
  role: role,
  createdAt: DateTime.fromMillisecondsSinceEpoch(0),
  text: text,
  error: error,
  metadata: {'deliveryState': ?delivery},
);

/// What a person said, with what they attached beneath it.
class UserMessageView extends StatelessWidget {
  const UserMessageView({super.key, required this.session, required this.item});

  final SessionRef session;
  final UserMessageItem item;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.end,
    children: [
      if (item.text.trim().isNotEmpty)
        MessageBubble(
          message: chatMessage(
            id: item.id,
            role: MessageRole.user,
            text: item.text,
          ),
        ),
      if (item.attachments.isNotEmpty)
        AttachmentRow(session: session, attachments: item.attachments),
    ],
  );
}

/// A transcript row that is not a turn: a compaction as the chat's divider,
/// a failed run as the chat's error card, a notice as an info card, a run
/// that simply ended as nothing, anything else (a stop, a model change) as a
/// quiet line.
class MarkerView extends StatelessWidget {
  const MarkerView({super.key, required this.item});

  final TranscriptItem item;

  @override
  Widget build(BuildContext context) => switch (item) {
    CompactionItem(:final trigger) => buildCompactionDividerEnhanced(
      context,
      auto: trigger != null && trigger != CompactionTrigger.manual,
      overflow: trigger == CompactionTrigger.overflow,
    ),
    RunBoundaryItem(outcome: RunCompleted()) => const SizedBox.shrink(),
    RunBoundaryItem(outcome: RunErrored(:final error)) => MessageBubble(
      message: chatMessage(
        id: item.id,
        role: MessageRole.assistant,
        text: error.message,
        error: 'run_failed',
      ),
    ),
    NoticeItem(:final level, :final text) => NoticeCard(
      text: text,
      color: noticeColor(level, OpenCodeTheme.of(context)),
    ),
    _ => _QuietLine(item: item),
  };
}

/// A notice in the chat's info-card style, tinted by its level.
class NoticeCard extends StatelessWidget {
  const NoticeCard({super.key, required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: Spacing.sm),
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
        constraints: const BoxConstraints(maxWidth: 340),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: Radii.brXl,
          border: Border.all(color: color.withValues(alpha: 0.2)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.info, color: color, size: 18),
            const SizedBox(width: Spacing.sm),
            Flexible(
              child: Text(
                text,
                style: TextStyle(
                  color: theme.textMuted,
                  fontSize: 14,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _QuietLine extends StatelessWidget {
  const _QuietLine({required this.item});

  final TranscriptItem item;

  @override
  Widget build(BuildContext context) {
    final (text, color) = markerText(item, OpenCodeTheme.of(context));
    return Padding(
      padding: Insets.screenV,
      child: Center(
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

/// Items of a long run the live view no longer holds; the transcript shows
/// them once the run ends.
class DroppedView extends StatelessWidget {
  const DroppedView({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.screenV,
    child: Center(
      child: Text(
        '$count earlier items of this run appear once it is saved',
        style: TextStyle(
          color: OpenCodeTheme.of(context).textMuted,
          fontSize: 12,
        ),
      ),
    ),
  );
}
