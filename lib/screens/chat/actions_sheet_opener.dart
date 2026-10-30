import 'package:broski/models/vcs.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/codex/cx_rate_limits_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/cc_actions_content.dart';
import 'package:broski/widgets/chat/codex_actions_content.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/chat/session_actions_content.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens the appropriate backend-specific actions sheet (⋯ menu).
///
/// Extracted from [FloatingHeader] which previously housed these methods.
/// Now triggered from the input bar's ⋯ button instead of the top header.
void openActionsSheet({
  required BuildContext context,
  required WidgetRef ref,
  required bool isClaudeCode,
  required bool isCodex,
  required void Function(String) onAction,
  // CC-specific (widget props not in providers)
  String? ccSessionModel,
  String? ccDraftModel,
  // OC-specific (not available in providers)
  VcsInfo? vcsInfo,
  bool isSessionShared = false,
  bool isCompacting = false,
  VoidCallback? onModelTap,
  VoidCallback? onOpenSidebar,
}) {
  final theme = OpenCodeTheme.of(context);
  final connection = ref.read(connectionProvider);
  final chatState = ref.read(chatSessionProvider);

  if (isClaudeCode) {
    _openClaudeCodeSheet(
      context,
      theme: theme,
      connection: connection,
      chatState: chatState,
      ccConfigModel: ref.read(ccConfigProvider).valueOrNull?.model,
      ccSessionModel: ccSessionModel,
      ccDraftModel: ccDraftModel,
      onAction: onAction,
    );
  } else if (isCodex) {
    _openCodexSheet(
      context,
      theme: theme,
      connection: connection,
      chatState: chatState,
      cxRateLimitData: ref.read(cxLiveRateLimitsProvider),
      onAction: onAction,
    );
  } else {
    _openOpenCodeSheet(
      context,
      theme: theme,
      connection: connection,
      chatState: chatState,
      currentModel: ref.read(selectionProvider).model,
      vcsInfo: vcsInfo,
      isSessionShared: isSessionShared,
      isCompacting: isCompacting,
      onModelTap: onModelTap,
      onOpenSidebar: onOpenSidebar,
      onAction: onAction,
    );
  }
}

void _openClaudeCodeSheet(
  BuildContext context, {
  required OpenCodeTheme theme,
  required BridgeConnectionState connection,
  required ChatSessionState chatState,
  required String? ccConfigModel,
  String? ccSessionModel,
  String? ccDraftModel,
  required void Function(String) onAction,
}) {
  // Match the full CC model fallback chain from input_bar_content.dart
  final ccModel =
      ccConfigModel ??
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

void _openCodexSheet(
  BuildContext context, {
  required OpenCodeTheme theme,
  required BridgeConnectionState connection,
  required ChatSessionState chatState,
  required Map<String, dynamic>? cxRateLimitData,
  required void Function(String) onAction,
}) {
  DetailSheet.show(
    context: context,
    title: 'Codex',
    initialSize: 0.5,
    child: CodexActionsContent(
      theme: theme,
      isConnected: connection.isConnected,
      rttMs: connection.rttMs,
      codexModel: chatState.cxModel,
      isStreaming: chatState.cxIsStreaming,
      onAction: (action) {
        Navigator.pop(context);
        onAction(action);
      },
    ),
  );
}

void _openOpenCodeSheet(
  BuildContext context, {
  required OpenCodeTheme theme,
  required BridgeConnectionState connection,
  required ChatSessionState chatState,
  required SelectedModel? currentModel,
  required VcsInfo? vcsInfo,
  required bool isSessionShared,
  required bool isCompacting,
  required VoidCallback? onModelTap,
  required VoidCallback? onOpenSidebar,
  required void Function(String) onAction,
}) {
  DetailSheet.show(
    context: context,
    title: 'Session',
    initialSize: 0.5,
    child: SessionActionsContent(
      theme: theme,
      vcsInfo: vcsInfo,
      isConnected: connection.isConnected,
      rttMs: connection.rttMs,
      currentModel: currentModel,
      onModelTap: () {
        Navigator.pop(context);
        onModelTap?.call();
      },
      isSessionShared: isSessionShared,
      isCompacting: isCompacting,
      isStreaming: chatState.messages.any((m) => m.isStreaming),
      onOpenSidebar: () {
        Navigator.pop(context);
        Future.delayed(
          const Duration(milliseconds: 150),
          () => onOpenSidebar?.call(),
        );
      },
      onAction: (action) {
        Navigator.pop(context);
        onAction(action);
      },
    ),
  );
}
