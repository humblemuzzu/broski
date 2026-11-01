import 'package:broski/models/message.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/services/haptics_service.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Forks the current Claude Code session.
Future<void> forkSession({
  required BuildContext context,
  required WidgetRef ref,
  required ChatScreen widget,
  required HapticsService haptics,
  String? messageId,
}) async {
  haptics.mediumImpact();
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
    showActionSnackBar(
      context,
      'Session forked: ${forkedCC.displayTitle}',
      actionLabel: 'Open',
      onAction: () {
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
    );
  } catch (e) {
    if (!context.mounted) return;
    showError(context, 'Failed to fork session: ${humanizeError(e)}');
  }
}
