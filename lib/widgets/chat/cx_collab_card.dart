import 'package:broski/models/codex.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Inline card showing multi-agent collaboration status in the Codex chat stream.
/// Watches the live collab tree from `ChatSessionState.cxCollabTree` and renders
/// a compact summary of spawned subagents and their statuses.
class CxCollabCard extends ConsumerWidget {
  const CxCollabCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tree = ref.watch(chatSessionProvider.select((s) => s.cxCollabTree));
    if (tree == null || tree.allNodes.isEmpty) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final nodes = tree.allNodes;
    final running = tree.runningAgents;
    final completed = tree.completedAgents;
    final total = tree.totalAgents;

    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.info.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Icon(AppIcons.gitBranch, size: 14, color: theme.info),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Multi-Agent Collaboration',
                    style: AppTypography.bodySmall(
                      color: theme.text,
                    ).copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
                // Status badge
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: running > 0
                        ? theme.info.withValues(alpha: 0.15)
                        : theme.success.withValues(alpha: 0.15),
                    borderRadius: Radii.brFull,
                  ),
                  child: Text(
                    running > 0 ? '$running running' : '$completed/$total done',
                    style: AppTypography.label(
                      color: running > 0 ? theme.info : theme.success,
                    ).copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
          ),
          // Agent list (compact, max 5 visible)
          ...nodes
              .take(5)
              .map((node) => _CollabAgentRow(node: node, theme: theme)),
          if (nodes.length > 5)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Text(
                '…and ${nodes.length - 5} more agents',
                style: AppTypography.label(color: theme.textMuted),
              ),
            ),
          const SizedBox(height: 6),
        ],
      ),
    );
  }
}

class _CollabAgentRow extends StatelessWidget {
  const _CollabAgentRow({required this.node, required this.theme});
  final CodexCollabAgentNode node;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    final statusIcon = switch (node.status) {
      CodexCollabAgentStatus.pendingInit ||
      CodexCollabAgentStatus.running => SizedBox(
        width: 12,
        height: 12,
        child: CircularProgressIndicator(
          strokeWidth: 1.5,
          color: node.status == CodexCollabAgentStatus.running
              ? theme.info
              : theme.textMuted,
        ),
      ),
      CodexCollabAgentStatus.completed => Icon(
        AppIcons.check,
        size: 12,
        color: theme.success,
      ),
      CodexCollabAgentStatus.errored => Icon(
        AppIcons.error,
        size: 12,
        color: theme.error,
      ),
      CodexCollabAgentStatus.shutdown => Icon(
        AppIcons.close,
        size: 12,
        color: theme.textMuted,
      ),
      _ => Icon(AppIcons.circleOutlined, size: 12, color: theme.textMuted),
    };

    final label =
        node.agentNickname ??
        node.agentRole ??
        'Agent ${node.threadId.substring(0, 8)}';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 3),
      child: Row(
        children: [
          statusIcon,
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              label,
              style: AppTypography.bodySmall(color: theme.text),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (node.prompt != null)
            Flexible(
              child: Text(
                node.prompt!,
                style: AppTypography.label(color: theme.textMuted),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
        ],
      ),
    );
  }
}
