import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/message.dart';
import '../../providers/chat_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/haptics_service.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../chat_screen.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Forks the current session (CC, Codex, or OpenCode).
/// Extracted from `_ChatScreenState._forkSession` in `chat_screen.dart`.
Future<void> forkSession({
  required BuildContext context,
  required WidgetRef ref,
  required ChatScreen widget,
  required HapticsService haptics,
  String? messageId,
}) async {
  haptics.mediumImpact();
  final theme = OpenCodeTheme.of(context);
  try {
    final bridge = ref.read(bridgeServiceProvider);
    final chatState = ref.read(chatSessionProvider);
    String? initialPrompt;
    if (messageId != null && messageId.isNotEmpty) {
      final idx = chatState.messages.indexWhere((m) => m.id == messageId);
      if (idx >= 0) {
        for (var i = idx; i >= 0; i--) {
          final m = chatState.messages[i];
          if (m.role == MessageRole.user && m.text.trim().isNotEmpty) {
            initialPrompt = m.text.trim();
            break;
          }
        }
        initialPrompt ??= chatState.messages[idx].text.trim();
      }
    }
    if (widget.isClaudeCode) {
      final sessionId = chatState.ccSessionId ?? widget.ccSession?.id;
      if (sessionId == null || sessionId.isEmpty) {
        showError(context, 'Cannot fork: no active session');
        return;
      }
      final forkedCC = await bridge.ccForkSession(
        sessionId,
        messageId: messageId,
        cwd: chatState.ccCwd ?? widget.ccSession?.cwd,
      );
      if (!context.mounted) return;
      if (forkedCC == null) {
        showError(context, 'Failed to fork session');
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Session forked: ${forkedCC.displayTitle}'),
          backgroundColor: theme.backgroundPanel,
          action: SnackBarAction(
            label: 'Open',
            textColor: theme.primary,
            onPressed: () {
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(
                  builder: (_) => ChatScreen.claudeCode(
                    ccSession: forkedCC,
                    initialPrompt: initialPrompt,
                  ),
                ),
              );
            },
          ),
        ),
      );
    } else if (widget.isCodex) {
      final threadId = chatState.cxThreadId ?? widget.cxThread?.id;
      if (threadId == null || threadId.isEmpty) {
        showError(context, 'Cannot fork: no active thread');
        return;
      }
      final forked = await bridge.cxThreadFork(threadId: threadId);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Thread forked: ${forked.preview}'),
          backgroundColor: theme.backgroundPanel,
          action: SnackBarAction(
            label: 'Open',
            textColor: theme.primary,
            onPressed: () {
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(
                  builder: (_) => ChatScreen.codex(
                    cxThread: forked,
                    initialPrompt: initialPrompt,
                  ),
                ),
              );
            },
          ),
        ),
      );
    } else {
      final forkedSession = await bridge.forkSession(
        widget.session.id,
        messageId: messageId,
        projectPath: widget.project.path,
      );
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Session forked: ${forkedSession.title}'),
          backgroundColor: theme.backgroundPanel,
          action: SnackBarAction(
            label: 'Open',
            textColor: theme.primary,
            onPressed: () {
              Navigator.pushReplacement(
                context,
                MaterialPageRoute(
                  builder: (_) => ChatScreen(
                    project: widget.project,
                    session: forkedSession,
                    initialPrompt: initialPrompt,
                  ),
                ),
              );
            },
          ),
        ),
      );
    }
  } catch (e) {
    if (!context.mounted) return;
    showError(context, 'Failed to fork session: ${humanizeError(e)}');
  }
}
