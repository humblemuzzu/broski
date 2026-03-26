import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/message.dart';
import '../../providers/chat_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';

/// Shows the timeline dialog to jump to a specific message.
/// Extracted from chat_screen.dart.
///
/// [scrollController] is used to scroll to the selected message.
void showTimelineDialog(
  BuildContext context, {
  required ScrollController scrollController,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Jump to Message',
    initialSize: 0.6,
    minSize: 0.4,
    maxSize: 0.9,
    child: Consumer(
      builder: (context, ref, _) {
        final chatState = ref.watch(chatSessionProvider);
        if (chatState.messages.isEmpty) {
          return Padding(
            padding: Insets.cardLg,
            child: Center(
              child: Text(
                'No messages in session',
                style: TextStyle(color: theme.textMuted),
              ),
            ),
          );
        }
        return ListView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: chatState.messages.length,
          itemBuilder: (context, index) {
            final msg = chatState.messages[index];
            final isUser = msg.role == MessageRole.user;
            return ListTile(
              leading: CircleAvatar(
                backgroundColor: isUser ? theme.primary : theme.accent,
                radius: 16,
                child: Icon(
                  isUser ? AppIcons.person : AppIcons.agent,
                  size: 16,
                  color: theme.selectedListItemText,
                ),
              ),
              title: Text(
                isUser ? 'You' : 'Assistant',
                style: TextStyle(fontWeight: FontWeight.w500, color: theme.text),
              ),
              subtitle: Text(
                msg.text.length > 60
                    ? '${msg.text.substring(0, 60)}...'
                    : msg.text,
                style: TextStyle(color: theme.textMuted),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              onTap: () {
                Navigator.pop(context);
                // Scroll to the message
                final targetIndex = chatState.messages.length - 1 - index;
                if (scrollController.hasClients) {
                  scrollController.animateTo(
                    targetIndex * 120.0, // Approximate message height
                    duration: const Duration(milliseconds: 300),
                    curve: Curves.easeInOut,
                  );
                }
              },
            );
          },
        );
      },
    ),
  );
}
