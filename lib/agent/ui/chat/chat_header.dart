import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/ui/chat/copy_text.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/panels/panels_sheet.dart';
import 'package:broski/agent/ui/pickers/live_settings_sheet.dart';
import 'package:broski/agent/ui/shared/status_look.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The session's title, with its status, model and usage beneath.
class ChatTitle extends StatelessWidget {
  const ChatTitle({super.key, required this.state});

  final AgentSessionState state;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final status = statusLook(state.status, theme);
    final usage = state.snapshot.usage;
    final details = [
      status.label,
      ?state.snapshot.modelId,
      ?state.snapshot.thinking,
      if (usage != null) ?usageLine(usage),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          state.summary?.title?.text ?? 'Session',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        Text(
          details.join(' · '),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppTypography.caption(color: status.color),
        ),
      ],
    );
  }
}

/// Tokens, cost and context fill as reported; null when nothing is.
String? usageLine(Usage usage) {
  final parts = [
    if (usage.contextTokens case final used?)
      usage.contextWindow == null
          ? '$used ctx'
          : '$used/${usage.contextWindow} ctx',
    if (usage.inputTokens case final input?) '$input in',
    if (usage.outputTokens case final output?) '$output out',
    if (usage.costUsd case final cost?) '\$${cost.toStringAsFixed(4)}',
  ];
  return parts.isEmpty ? null : parts.join(' ');
}

/// The session-wide actions its capabilities allow: settings, compaction and
/// the backend's own operations.
class ChatActions extends ConsumerWidget {
  const ChatActions({
    super.key,
    required this.session,
    required this.state,
    required this.capabilities,
  });

  final SessionRef session;
  final AgentSessionState state;
  final Capabilities capabilities;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final controls = ref.read(sessionProvider(session).notifier).controls;
    final panels = panelsAt(
      capabilities,
      OpPlace.session,
      controllable: state.controllable,
    );
    final lastAnswer = ref.watch(lastAnswerProvider(session));
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (lastAnswer != null)
          IconButton(
            key: const ValueKey('chat-copy-last'),
            tooltip: 'Copy last answer',
            icon: const Icon(AppIcons.copy),
            onPressed: () => copyToClipboard(context, lastAnswer),
          ),
        if (state.controllable)
          IconButton(
            key: const ValueKey('chat-settings'),
            tooltip: 'Model and modes',
            icon: const Icon(AppIcons.tune),
            onPressed: () => showLiveSettings(context, session, capabilities),
          ),
        if (state.controllable && (state.capabilities?.compact ?? false))
          IconButton(
            key: const ValueKey('chat-compact'),
            tooltip: 'Compact',
            icon: const Icon(AppIcons.compress),
            onPressed: () async {
              final instructions = await askForText(
                context,
                title: 'Compact the conversation',
                action: 'Compact',
                hint: 'Instructions (optional)',
                allowEmpty: true,
              );
              if (instructions == null) return;
              await controls.compact(
                instructions: instructions.isEmpty ? null : instructions,
              );
            },
          ),
        if (panels.isNotEmpty)
          IconButton(
            key: const ValueKey('chat-panels'),
            tooltip: 'More',
            icon: const Icon(AppIcons.moreVertical),
            onPressed: () => showPanels(
              context,
              session,
              capabilities,
              controllable: state.controllable,
            ),
          ),
      ],
    );
  }
}
