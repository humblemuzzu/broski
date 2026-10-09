import 'package:broski/models/pi_durable/pi_durable_usage.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_durable/pi_durable_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/format_utils.dart';
import 'package:broski/widgets/chat/action_row.dart';
import 'package:broski/widgets/chat/agent_status_bar.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

const pdStopActionId = 'pd_stop';
const pdModelActionId = 'pd_model';
const pdCompactActionId = 'pd_compact';
const pdCopySessionIdActionId = 'pd_copy_session_id';
const pdDeleteActionId = 'pd_delete';

/// One tappable action in the durable actions sheet. The list and the dispatch
/// are pure so the sheet's wiring can be asserted without pumping a widget.
class PiDurableAction {
  const PiDurableAction({
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.id,
  });

  final IconData icon;
  final String label;
  final String subtitle;
  final String id;
}

/// Stop is only offered while a turn is running; every other action is always
/// available on a durable session.
List<PiDurableAction> piDurableActions({required bool isStreaming}) => [
  if (isStreaming)
    const PiDurableAction(
      icon: AppIcons.stop,
      label: 'Stop',
      subtitle: 'Abort the current response',
      id: pdStopActionId,
    ),
  const PiDurableAction(
    icon: AppIcons.autoAwesome,
    label: 'Model & thinking',
    subtitle: 'Switch model and reasoning level',
    id: pdModelActionId,
  ),
  const PiDurableAction(
    icon: AppIcons.compress,
    label: 'Compact now',
    subtitle: 'Summarize the context and keep working',
    id: pdCompactActionId,
  ),
  const PiDurableAction(
    icon: AppIcons.copy,
    label: 'Copy session id',
    subtitle: 'Copy the durable session id',
    id: pdCopySessionIdActionId,
  ),
  const PiDurableAction(
    icon: AppIcons.delete,
    label: 'Delete session',
    subtitle: 'Remove it from your Mac',
    id: pdDeleteActionId,
  ),
];

class PiDurableActionHandlers {
  const PiDurableActionHandlers({
    required this.onStop,
    required this.onShowModel,
    required this.onCompact,
    required this.onCopySessionId,
    required this.onDelete,
  });

  final VoidCallback onStop;
  final VoidCallback onShowModel;
  final VoidCallback onCompact;
  final VoidCallback onCopySessionId;
  final VoidCallback onDelete;
}

/// Runs the handler for [id]; false when the id belongs to no action.
bool dispatchPiDurableAction(String id, PiDurableActionHandlers handlers) {
  switch (id) {
    case pdStopActionId:
      handlers.onStop();
    case pdModelActionId:
      handlers.onShowModel();
    case pdCompactActionId:
      handlers.onCompact();
    case pdCopySessionIdActionId:
      handlers.onCopySessionId();
    case pdDeleteActionId:
      handlers.onDelete();
    default:
      return false;
  }
  return true;
}

/// Actions sheet content for the durable Pi backend.
class PiDurableActionsContent extends ConsumerWidget {
  const PiDurableActionsContent({
    super.key,
    required this.theme,
    required this.isConnected,
    required this.rttMs,
    required this.onAction,
  });

  final OpenCodeTheme theme;
  final bool isConnected;
  final int? rttMs;
  final void Function(String) onAction;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final chatState = ref.watch(chatSessionProvider);
    final usage = PiDurableUsage.fromUsage(chatState.pdUsage);
    final models = ref.watch(piDurableModelsProvider).valueOrNull ?? const [];
    final contextWindow = piDurableContextWindow(models, chatState.pdModel);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        AgentStatusBar(
          theme: theme,
          isConnected: isConnected,
          rttMs: rttMs,
          modelName: getModelDisplayName(
            chatState.pdModel,
            fallback: 'Default',
          ),
          modelColor: theme.primary,
          onModelTap: () => onAction(pdModelActionId),
          bottomPadding: 12,
        ),
        if (usage.hasUsage)
          _UsageBlock(
            theme: theme,
            usage: usage,
            contextWindow: contextWindow,
            contextTokens: chatState.pdContextTokens,
          ),
        Padding(
          padding: Insets.screenAll,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SectionHeader(title: 'ACTIONS', theme: theme),
              const SizedBox(height: Spacing.md),
              for (final action in piDurableActions(
                isStreaming: chatState.pdIsStreaming,
              ))
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: ActionRow(
                    icon: action.icon,
                    label: action.label,
                    subtitle: action.subtitle,
                    theme: theme,
                    color: action.id == pdDeleteActionId ? theme.error : null,
                    onTap: () => onAction(action.id),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _UsageBlock extends StatelessWidget {
  const _UsageBlock({
    required this.theme,
    required this.usage,
    required this.contextWindow,
    required this.contextTokens,
  });

  final OpenCodeTheme theme;
  final PiDurableUsage usage;
  final int contextWindow;
  final int? contextTokens;

  @override
  Widget build(BuildContext context) {
    final tokens = contextTokens ?? usage.totalTokens;
    final percent = contextWindow > 0
        ? (tokens / contextWindow * 100).clamp(0.0, 100.0)
        : 0.0;
    final barColor = percent > 80
        ? theme.error
        : percent > 50
        ? theme.warning
        : theme.info;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: theme.backgroundPanel,
          borderRadius: Radii.brMd,
          border: Border.all(color: theme.borderSubtle),
        ),
        child: Column(
          children: [
            Row(
              children: [
                Icon(AppIcons.memory, size: 13, color: theme.info),
                const SizedBox(width: 6),
                Text(
                  '${formatTokens(tokens)} / ${formatTokens(contextWindow)}',
                  style: AppTypography.caption(color: theme.textMuted),
                ),
                const SizedBox(width: 6),
                Text(
                  '${percent.toStringAsFixed(1)}%',
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w600,
                    color: barColor,
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: theme.success.withValues(alpha: 0.1),
                    borderRadius: Radii.brSm,
                  ),
                  child: Text(
                    usage.costLabel,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: theme.success,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            ClipRRect(
              borderRadius: Radii.brXs,
              child: LinearProgressIndicator(
                value: (percent / 100).clamp(0.0, 1.0),
                minHeight: 4,
                color: barColor,
                backgroundColor: theme.backgroundElement,
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text(
                  'In ${formatTokens(usage.input)}',
                  style: AppTypography.caption(color: theme.textMuted),
                ),
                Text(
                  '  Out ${formatTokens(usage.output)}',
                  style: AppTypography.caption(color: theme.textMuted),
                ),
                const Spacer(),
                if (usage.cacheRead > 0 || usage.cacheWrite > 0)
                  Text(
                    'R ${formatTokens(usage.cacheRead)}  W ${formatTokens(usage.cacheWrite)}',
                    style: AppTypography.caption(
                      color: theme.info.withValues(alpha: 0.7),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
