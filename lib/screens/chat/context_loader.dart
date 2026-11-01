import 'package:broski/models/session_context.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/utils/format_utils.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Loads session context (token usage, cost, modified files) from the stream
/// state. The caller is responsible for calling `setState` with the result.
Future<SessionContext> loadSessionContext({
  required WidgetRef ref,
  required ChatScreen widget,
}) async {
  final chatState = ref.read(chatSessionProvider);
  final tokenUsage = chatState.ccTokenUsage;
  final ccConfig = ref.read(ccConfigProvider).valueOrNull;
  final sessionId = chatState.ccSessionId ?? widget.ccSession?.id ?? '';

  // Per-file modified files, scanned from the session's .jsonl transcript.
  List<ModifiedFile> modifiedFiles = const [];
  if (sessionId.isNotEmpty) {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final raw = await bridge.ccGetModifiedFiles(
        sessionId,
        cwd: chatState.ccCwd,
      );
      modifiedFiles = raw.map((item) => ModifiedFile.fromJson(item)).toList();
    } catch (_) {
      // Non-critical — sidebar just shows empty
    }
  }

  final context = SessionContext.fromClaudeCode(
    inputTokens: tokenUsage?.inputTokens ?? 0,
    outputTokens: tokenUsage?.outputTokens ?? 0,
    cacheReadTokens: tokenUsage?.cacheReadTokens ?? 0,
    cacheWriteTokens: tokenUsage?.cacheCreationTokens ?? 0,
    reasoningTokens: 0,
    totalCostUsd: tokenUsage?.totalCostUsd,
    budgetLimitUsd: ccConfig?.maxBudgetUsd,
    contextWindow: tokenUsage?.effectiveContextWindow ?? kDefaultContextWindow,
    lastIterContextTokens: tokenUsage?.lastIterContextTokens,
    modifiedFiles: modifiedFiles,
  );
  return context;
}
