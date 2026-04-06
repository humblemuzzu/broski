import 'package:broski/models/session_context.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/utils/format_utils.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Loads session context (token usage, cost) for any agent type.
///
/// Extracted from `_ChatScreenState._loadSessionContext` in `chat_screen.dart`.
///
/// Returns the loaded [SessionContext]. The caller is responsible for calling
/// `setState` with the result.
Future<SessionContext> loadSessionContext({
  required WidgetRef ref,
  required ChatScreen widget,
}) async {
  final storage = ref.read(storageServiceProvider);
  final connection = ref.read(connectionProvider);

  // Claude Code mode - build context from stream state
  if (widget.isClaudeCode) {
    final chatState = ref.read(chatSessionProvider);
    final tokenUsage = chatState.ccTokenUsage;
    final ccConfig = ref.read(ccConfigProvider).valueOrNull;
    final sessionId = chatState.ccSessionId ?? widget.ccSession?.id ?? '';

    // Fetch per-file modified files from bridge (scans CC .jsonl transcript)
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
      contextWindow:
          tokenUsage?.effectiveContextWindow ?? kDefaultContextWindow,
      lastIterContextTokens: tokenUsage?.lastIterContextTokens,
      modifiedFiles: modifiedFiles,
    );
    if (sessionId.isNotEmpty) {
      await storage.cacheSessionContext(sessionId, context);
    }
    return context;
  }

  // Codex mode - build context from stream token usage
  if (widget.isCodex) {
    final chatState = ref.read(chatSessionProvider);
    final tokenUsage = chatState.cxTokenUsage;
    final total = tokenUsage?.total;
    final last = tokenUsage?.last;
    final contextWindow =
        tokenUsage?.modelContextWindow ?? kDefaultContextWindow;
    final inputTokens = total?.inputTokens ?? 0;
    final outputTokens = total?.outputTokens ?? 0;
    final cachedInputTokens = total?.cachedInputTokens ?? 0;
    final reasoningTokens = total?.reasoningOutputTokens ?? 0;
    final cacheWriteTokens = total?.cacheWriteTokens ?? 0;
    final contextTokens = last?.inputTokens ?? inputTokens;
    final threadId = chatState.cxThreadId ?? widget.cxThread?.id ?? '';

    // Fetch per-file modified files from bridge (scans Codex .jsonl)
    List<ModifiedFile> modifiedFiles = const [];
    if (threadId.isNotEmpty) {
      try {
        final bridge = ref.read(bridgeServiceProvider);
        final raw = await bridge.cxGetModifiedFiles(threadId);
        modifiedFiles = raw.map((item) => ModifiedFile.fromJson(item)).toList();
      } catch (_) {
        // Non-critical — sidebar just shows empty
      }
    }

    final context = SessionContext.fromCodex(
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      cachedInputTokens: cachedInputTokens,
      reasoningTokens: reasoningTokens,
      cacheWriteTokens: cacheWriteTokens,
      contextWindow: contextWindow,
      contextTokens: contextTokens,
      modifiedFiles: modifiedFiles,
    );
    if (threadId.isNotEmpty) {
      await storage.cacheSessionContext(threadId, context);
    }
    return context;
  }

  // Pi mode - build context from session stats
  if (widget.isPi) {
    try {
      final piBridge = ref.read(piBridgeServiceProvider);
      final chatState = ref.read(chatSessionProvider);
      final cwd = chatState.piCwd;

      // Fetch stats and modified files in parallel
      final statsFuture = piBridge.getSessionStats(projectPath: cwd);
      final filesFuture = piBridge.getModifiedFiles(projectPath: cwd);
      final stats = await statsFuture;
      List<ModifiedFile> modifiedFiles = const [];
      try {
        final raw = await filesFuture;
        modifiedFiles = raw.map((item) => ModifiedFile.fromJson(item)).toList();
      } catch (_) {
        // Non-critical
      }

      final ctxUsage = stats.contextUsage;
      return SessionContext.fromPi(
        inputTokens: stats.tokens.input,
        outputTokens: stats.tokens.output,
        cacheReadTokens: stats.tokens.cacheRead,
        cacheWriteTokens: stats.tokens.cacheWrite,
        totalCost: stats.cost,
        contextWindow:
            ctxUsage?.contextWindow ??
            chatState.piModelData?.contextWindow ??
            kDefaultContextWindow,
        actualContextTokens: ctxUsage?.tokens ?? 0,
        modifiedFiles: modifiedFiles,
      );
    } catch (_) {
      return SessionContext.empty();
    }
  }

  // OpenCode offline mode - use cached data
  if (connection.isOfflineMode) {
    final cachedContext = await storage.getCachedSessionContext(
      widget.session.id,
    );
    final cachedTodos = await storage.getCachedSessionTodos(widget.session.id);
    if (cachedTodos.isNotEmpty) {
      ref.read(chatSessionProvider.notifier).setTodos(cachedTodos);
    }
    return cachedContext ?? SessionContext.empty();
  }

  // OpenCode mode - fetch from bridge
  try {
    final bridge = ref.read(bridgeServiceProvider);
    final contextFuture = bridge.getSessionContext(
      widget.session.id,
      projectPath: widget.project.path,
    );
    final todosFuture = bridge.getTodos(
      widget.session.id,
      projectPath: widget.project.path,
    );
    final contextData = await contextFuture;
    final todosData = await todosFuture;
    final context = SessionContext.fromJson(contextData);
    await storage.cacheSessionContext(widget.session.id, context);
    if (todosData.isNotEmpty) {
      await storage.cacheSessionTodos(widget.session.id, todosData);
    }
    ref.read(chatSessionProvider.notifier).setTodos(todosData);
    return context;
  } catch (_) {
    final cachedContext = await storage.getCachedSessionContext(
      widget.session.id,
    );
    return cachedContext ?? SessionContext.empty();
  }
}
