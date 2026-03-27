import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/message.dart';
import '../../models/project.dart';
import '../../models/session.dart';
import '../../providers/chat_provider.dart';
import '../../providers/service_providers.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../chat_screen.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Shows the fork dialog to create a branch from a specific message.
/// Extracted from chat_screen.dart.
void showForkDialog(
  BuildContext context, {
  required SessionSummary session,
  required ProjectSummary project,
}) {
  final theme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Fork Session',
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
                'No messages to fork from',
                style: TextStyle(color: theme.textMuted),
              ),
            ),
          );
        }
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: Insets.bottomSm,
              child: Text(
                'Select a message to fork from',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
            ),
            ListView.builder(
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
                    style: TextStyle(
                      fontWeight: FontWeight.w500,
                      color: theme.text,
                    ),
                  ),
                  subtitle: Text(
                    msg.text.length > 60
                        ? '${msg.text.substring(0, 60)}...'
                        : msg.text,
                    style: TextStyle(color: theme.textMuted),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: Icon(AppIcons.forkRight, color: theme.primary),
                  onTap: () async {
                    Navigator.pop(context);
                    try {
                      final bridge = ref.read(bridgeServiceProvider);
                      final forkedSession = await bridge.forkSession(
                        session.id,
                        messageId: msg.id,
                        projectPath: project.path,
                      );
                      if (!context.mounted) return;
                      String? initialPrompt;
                      final idx = chatState.messages.indexWhere(
                        (m) => m.id == msg.id,
                      );
                      if (idx >= 0) {
                        for (var i = idx; i >= 0; i--) {
                          final m = chatState.messages[i];
                          if (m.role == MessageRole.user &&
                              m.text.trim().isNotEmpty) {
                            initialPrompt = m.text.trim();
                            break;
                          }
                        }
                        initialPrompt ??= msg.text.trim();
                      }
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Forked to "${forkedSession.title}"'),
                          action: SnackBarAction(
                            label: 'Open',
                            onPressed: () {
                              // Navigate to the forked session
                              Navigator.pushReplacement(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => ChatScreen(
                                    project: project,
                                    session: forkedSession,
                                    initialPrompt: initialPrompt,
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
                      );
                    } catch (e) {
                      if (!context.mounted) return;
                      showInfo(context, 'Failed to fork: ${humanizeError(e)}');
                    }
                  },
                );
              },
            ),
          ],
        );
      },
    ),
  );
}
