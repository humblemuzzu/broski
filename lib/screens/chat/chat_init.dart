import 'package:broski/models/agent.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/codex/cx_error_listener.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Sets the active view on the bridge for the current agent backend.
/// Used both during initial setup and after reconnection.
///
/// Extracted from `_ChatScreenState.initState` in `chat_screen.dart`.
void setViewForAgent({
  required BridgeService bridge,
  required ChatScreen widget,
}) {
  if (widget.isOpenCode) {
    bridge.setView(
      projectPath: widget.project.path,
      sessionId: widget.session.id,
      agent: 'opencode',
    );
  } else if (widget.isClaudeCode) {
    final sessionId = widget.ccSession?.id ?? '';
    if (sessionId.isNotEmpty) {
      bridge.setView(sessionId: sessionId, agent: 'claude-code');
    }
  } else if (widget.isCodex) {
    final threadId = widget.cxThread?.id ?? '';
    if (threadId.isNotEmpty) {
      bridge.setView(sessionId: threadId, agent: 'codex');
    }
  }
}

/// Sets up initial project context and view routing in the first post-frame
/// callback.
///
/// Extracted from `_ChatScreenState.initState` in `chat_screen.dart`.
void setupInitialProjectContext({
  required WidgetRef ref,
  required BridgeService bridge,
  required ChatScreen widget,
}) {
  final selection = ref.read(selectionProvider.notifier);
  final initialProject = widget.isOpenCode
      ? widget.project
      : ProjectSummary(
          id: '',
          name: widget.projectName,
          path: widget.effectivePath,
        );
  selection.selectProject(initialProject);
  if (widget.isOpenCode && widget.session.id.isNotEmpty) {
    selection.selectSession(widget.session);
  }
  setViewForAgent(bridge: bridge, widget: widget);
}

/// Result from setting up Claude Code subscriptions.
class ClaudeCodeSubscriptions {
  final ProviderSubscription<AsyncValue<ClaudeCodeConfig>>? configSub;
  final ProviderSubscription<bool>? queueSub;
  const ClaudeCodeSubscriptions({this.configSub, this.queueSub});
}

/// Sets up Claude Code-specific subscriptions: config preloading, subagent
/// sync into the @-mention autocomplete list, and queue auto-send on turn end.
///
/// Returns subscriptions that must be closed in `dispose()`.
///
/// Extracted from `_ChatScreenState.initState` in `chat_screen.dart`.
ClaudeCodeSubscriptions setupClaudeCodeSubscriptions({
  required WidgetRef ref,
  required ChatScreen widget,
  required void Function(List<Agent>) onSubagentsChanged,
  required void Function() onQueueTurnComplete,
}) {
  ref.read(ccConfigProvider.notifier).load();
  ref.read(ccCustomToolsProvider.notifier).load();
  ref.read(ccPluginsProvider.notifier).load(cwd: widget.effectivePath);

  final configSub = ref.listenManual(ccConfigProvider, (previous, next) {
    final cfg = next.valueOrNull;
    if (cfg == null) return;
    final subagentAgents = cfg.subagents
        .where((s) => s.name.isNotEmpty)
        .map(
          (s) => Agent(
            name: s.name,
            description: s.description,
            mode: AgentMode.subagent,
          ),
        )
        .toList();
    onSubagentsChanged(subagentAgents);
  });

  final queueSub = ref.listenManual(
    chatSessionProvider.select((s) => s.ccIsStreaming),
    (previous, next) {
      if (previous == true && next == false) {
        onQueueTurnComplete();
      }
    },
  );

  return ClaudeCodeSubscriptions(configSub: configSub, queueSub: queueSub);
}

/// Sets up the Codex queue listener: when cxIsStreaming transitions
/// true → false, fire [onQueueTurnComplete] to auto-send queued messages.
///
/// Returns the subscription (must be closed in dispose()).
///
/// Extracted from `_ChatScreenState.initState` in `chat_screen.dart`.
ProviderSubscription<bool>? setupCodexQueueSubscription({
  required WidgetRef ref,
  required ChatScreen widget,
  required void Function() onQueueTurnComplete,
}) {
  if (!widget.isCodex) return null;
  return ref.listenManual(chatSessionProvider.select((s) => s.cxIsStreaming), (
    previous,
    next,
  ) {
    if (previous == true && next == false) {
      onQueueTurnComplete();
    }
  });
}

/// Sets up the Codex error listener: shows a snackbar when the bridge
/// reports a Codex error (e.g. handler failure, SDK error).
///
/// Extracted from cx_error_listener.dart — wired into chat lifecycle.
void setupCxErrorListenerIfCodex({
  required WidgetRef ref,
  required BuildContext context,
  required ChatScreen widget,
}) {
  if (!widget.isCodex) return;
  setupCxErrorListener(ref, context);
}

/// Sets up token usage listeners that refresh the header context pill when CC
/// or CX turn usage changes.
///
/// Extracted from `_ChatScreenState.initState` in `chat_screen.dart`.
void setupTokenUsageListeners({
  required WidgetRef ref,
  required ChatScreen widget,
  required void Function() onTokenUsageChanged,
}) {
  if (widget.isClaudeCode) {
    ref.listenManual(
      chatSessionProvider.select((s) => s.ccTokenUsage),
      (_, __) => onTokenUsageChanged(),
    );
  } else if (widget.isCodex) {
    ref.listenManual(
      chatSessionProvider.select((s) => s.cxTokenUsage),
      (_, __) => onTokenUsageChanged(),
    );
  }
}
