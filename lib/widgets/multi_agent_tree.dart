
import 'package:flutter/material.dart';
import '../models/codex.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';
/// Displays a tree visualization of multi-agent collaboration in Codex.
/// Shows: main thread -> spawned agents with status indicators.
///
/// Visual representation:
/// ┌─ Main Thread (running)
/// │   ├─ Worker Agent 1 (completed)
/// │   ├─ Worker Agent 2 (running)
/// │   └─ Worker Agent 3 (pending)
class MultiAgentTreeWidget extends StatelessWidget {
  const MultiAgentTreeWidget({
    super.key,
    required this.tree,
    this.onAgentTap,
    this.compact = false,
  });
  final CodexCollabAgentTree tree;
  final void Function(String threadId)? onAgentTap;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    final root = tree.getNode(tree.rootThreadId);
    if (root == null && tree.allNodes.isEmpty) {
      return const SizedBox.shrink();
    }
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      padding: EdgeInsets.all(compact ? 8 : 12),
      decoration: BoxDecoration(
        color: ocTheme.bgRaised,
        borderRadius: Radii.brSm,
        border: Border.all(
          color: ocTheme.borderSubtle,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Header
          Row(
            children: [
              Icon(
                AppIcons.gitBranch,
                size: compact ? 14 : 16,
                color: theme.colorScheme.primary,
              ),
              const SizedBox(width: 6),
              Text(
                'Multi-Agent Collaboration',
                style: TextStyle(
                  fontSize: compact ? 11 : 12,
                  fontWeight: FontWeight.w600,
                  color: theme.colorScheme.primary,
                ),
              ),
              const Spacer(),
              // Progress indicator
              Text(
                '${tree.completedAgents}/${tree.totalAgents} completed',
                style: TextStyle(
                  fontSize: compact ? 10 : 11,
                  color: ocTheme.textMuted,
                ),
              ),
            ],
          ),
          SizedBox(height: compact ? 8 : 12),
          // Agent tree
          if (root != null)
            _buildAgentNode(context, root, 0)
          else
            ...tree.allNodes.map((node) => _buildAgentNode(context, node, 0)),
        ],
      ),
    );
  }
  Widget _buildAgentNode(
    BuildContext context,
    CodexCollabAgentNode node,
    int depth,
  ) {
    final children = tree.getChildren(node.threadId);
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: EdgeInsets.only(left: depth * (compact ? 16.0 : 20.0)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: () => onAgentTap?.call(node.threadId),
            child: Container(
              padding: EdgeInsets.symmetric(
                horizontal: compact ? 8 : 10,
                vertical: compact ? 4 : 6,
              ),
              margin: EdgeInsets.only(bottom: compact ? 4 : 6),
              decoration: BoxDecoration(
                color: _getStatusColor(ocTheme, node.status).withValues(alpha: 0.1),
                borderRadius: Radii.brSm,
                border: Border.all(
                  color: _getStatusColor(ocTheme, node.status).withValues(alpha: 0.5),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _getStatusIcon(context, node.status),
                  SizedBox(width: compact ? 4 : 6),
                  Flexible(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          node.threadId == tree.rootThreadId
                              ? 'Main Thread'
                              : 'Agent ${node.threadId.length > 8 ? node.threadId.substring(0, 8) : node.threadId}',
                          style: TextStyle(
                            fontWeight: FontWeight.w500,
                            fontSize: compact ? 11 : 12,
                            color: ocTheme.text,
                          ),
                        ),
                        if (node.prompt != null &&
                            node.prompt!.isNotEmpty &&
                            !compact)
                          Text(
                            node.prompt!.length > 40
                                ? '${node.prompt!.substring(0, 40)}...'
                                : node.prompt!,
                            style: TextStyle(
                              fontSize: 10,
                              color: ocTheme.textMuted,
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (node.waitingForThreadIds.isNotEmpty) ...[
                    SizedBox(width: compact ? 4 : 6),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 4,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: ocTheme.warning.withValues(alpha: 0.2),
                        borderRadius: Radii.brXs,
                      ),
                      child: Text(
                        'waiting ${node.waitingForThreadIds.length}',
                        style: TextStyle(
                          fontSize: compact ? 9 : 10,
                          color: ocTheme.warning,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          ...children.map(
            (child) => _buildAgentNode(context, child, depth + 1),
          ),
        ],
      ),
    );
  }
  Color _getStatusColor(OpenCodeTheme theme, CodexCollabAgentStatus status) {
    switch (status) {
      case CodexCollabAgentStatus.pendingInit:
        return theme.textMuted;
      case CodexCollabAgentStatus.running:
        return theme.info;
      case CodexCollabAgentStatus.completed:
        return theme.success;
      case CodexCollabAgentStatus.errored:
        return theme.error;
      case CodexCollabAgentStatus.shutdown:
        return theme.warning;
      case CodexCollabAgentStatus.notFound:
        return theme.textMuted;
    }
  }
  Widget _getStatusIcon(BuildContext context, CodexCollabAgentStatus status) {
    final size = compact ? 14.0 : 16.0;
    final ocTheme = OpenCodeTheme.of(context);
    switch (status) {
      case CodexCollabAgentStatus.pendingInit:
        return Icon(
          AppIcons.hourglass,
          size: size,
          color: ocTheme.textMuted,
        );
      case CodexCollabAgentStatus.running:
        return SizedBox(
          width: size,
          height: size,
          child: CircularProgressIndicator(strokeWidth: 2, color: ocTheme.info),
        );
      case CodexCollabAgentStatus.completed:
        return Icon(AppIcons.checkCircle, size: size, color: ocTheme.success);
      case CodexCollabAgentStatus.errored:
        return Icon(AppIcons.error, size: size, color: ocTheme.error);
      case CodexCollabAgentStatus.shutdown:
        return Icon(
          AppIcons.stop,
          size: size,
          color: ocTheme.warning,
        );
      case CodexCollabAgentStatus.notFound:
        return Icon(AppIcons.help, size: size, color: ocTheme.textMuted);
    }
  }
}
/// A compact indicator showing multi-agent status (for message bubbles)
class MultiAgentIndicator extends StatelessWidget {
  const MultiAgentIndicator({super.key, required this.tree, this.onTap});
  final CodexCollabAgentTree tree;
  final VoidCallback? onTap;
  @override
  Widget build(BuildContext context) {
    if (tree.totalAgents <= 1) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final running = tree.runningAgents;
    final completed = tree.completedAgents;
    final total = tree.totalAgents;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: Insets.chip,
        decoration: BoxDecoration(
          color: theme.colorScheme.primaryContainer.withValues(alpha: 0.3),
          borderRadius: Radii.brMd,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              AppIcons.gitBranch,
              size: 12,
              color: theme.colorScheme.primary,
            ),
            SizedBox(width: Spacing.xs),
            if (running > 0)
              SizedBox(
                width: 10,
                height: 10,
                child: CircularProgressIndicator(
                  strokeWidth: 1.5,
                  color: theme.colorScheme.primary,
                ),
              )
            else
              Icon(AppIcons.check, size: 12, color: OpenCodeTheme.of(context).success),
            SizedBox(width: Spacing.xs),
            Text(
              '$completed/$total',
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w500,
                color: theme.colorScheme.primary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
