import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/screens/agent/chat/chat_sidebar_data.dart';
import 'package:broski/screens/agent/chat/plan_card.dart';
import 'package:broski/screens/agent/chat/timeline_providers.dart';
import 'package:broski/screens/agent/shared/status_look.dart';
import 'package:broski/screens/chat/session_actions.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/sidebar/shared_session_sidebar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The chat's sidebar for a session: how full its context is, what it runs
/// on, its plan, and the files it changed.
class ChatSidebar extends ConsumerWidget {
  const ChatSidebar({super.key, required this.state});

  final AgentSessionState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = state.ref;
    final diffs = sessionDiffsOf([
      ...ref.watch(historyTimelineProvider(session)).entries,
      ...ref.watch(liveTimelineProvider(session)),
    ]);
    final snapshot = state.snapshot;
    final status = statusLook(state.status, OpenCodeTheme.of(context));
    return SharedSessionSidebar(
      sessionTitle: state.summary?.title?.text ?? 'Session',
      sessionContext: sidebarContext(snapshot.usage, diffs),
      todos: todosOf(snapshot.plan),
      sessionDiffs: diffs,
      onOpenDiff: (diff) => openDiffView(context: context, diff: diff),
      onClose: () => Navigator.of(context).maybePop(),
      infoRows: [
        (icon: AppIcons.info, label: 'Status', value: status.label),
        if (snapshot.modelId case final model?)
          (icon: AppIcons.autoAwesome, label: 'Model', value: model),
        if (snapshot.thinking case final thinking?)
          (icon: AppIcons.bolt, label: 'Thinking', value: thinking),
        if (state.summary?.cwd case final cwd?)
          (icon: AppIcons.folder, label: 'Directory', value: cwd),
      ],
    );
  }
}
