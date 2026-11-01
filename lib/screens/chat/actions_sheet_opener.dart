import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/cc_actions_content.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens the Claude Code actions sheet (⋯ menu from the input bar).
void openActionsSheet({
  required BuildContext context,
  required WidgetRef ref,
  required void Function(String) onAction,
  String? ccSessionModel,
  String? ccDraftModel,
  bool isCompacting = false,
  VoidCallback? onOpenSidebar,
}) {
  final theme = OpenCodeTheme.of(context);
  final connection = ref.read(connectionProvider);
  final chatState = ref.read(chatSessionProvider);
  // Match the full CC model fallback chain from input_bar_content.dart
  final ccModel =
      ref.read(ccConfigProvider).valueOrNull?.model ??
      chatState.ccModel ??
      chatState.ccInit?.model ??
      ccSessionModel ??
      ccDraftModel;

  DetailSheet.show(
    context: context,
    title: 'Claude Code',
    initialSize: 0.5,
    child: ClaudeCodeActionsContent(
      theme: theme,
      isConnected: connection.isConnected,
      rttMs: connection.rttMs,
      ccModel: ccModel,
      isStreaming: chatState.ccIsStreaming,
      onAction: (action) {
        Navigator.pop(context);
        onAction(action);
      },
    ),
  );
}
