import 'package:broski/models/agent.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Sets the active view on the bridge for this chat's session.
/// Used both during initial setup and after reconnection.
void setViewForAgent({
  required BridgeService bridge,
  required ChatScreen widget,
}) {
  final sessionId = widget.ccSession?.id ?? '';
  if (sessionId.isNotEmpty) {
    bridge.setView(sessionId: sessionId, agent: 'claude-code');
  }
}

/// Sets up initial project context and view routing in the first post-frame
/// callback.
void setupInitialProjectContext({
  required WidgetRef ref,
  required BridgeService bridge,
  required ChatScreen widget,
}) {
  ref
      .read(selectionProvider.notifier)
      .selectProject(
        ProjectSummary(
          id: '',
          name: widget.projectName,
          path: widget.effectivePath,
        ),
      );
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

/// Refreshes the header context pill when a turn's token usage changes.
void setupTokenUsageListeners({
  required WidgetRef ref,
  required ChatScreen widget,
  required void Function() onTokenUsageChanged,
}) {
  ref.listenManual(
    chatSessionProvider.select((s) => s.ccTokenUsage),
    (_, __) => onTokenUsageChanged(),
  );
}
