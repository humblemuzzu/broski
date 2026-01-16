import 'package:flutter/material.dart';
import '../models/codex.dart';

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
    final isDark = theme.brightness == Brightness.dark;

    return Container(
      padding: EdgeInsets.all(compact ? 8 : 12),
      decoration: BoxDecoration(
        color: isDark
            ? Colors.grey.shade900.withOpacity(0.5)
            : Colors.grey.shade100,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(
          color: isDark ? Colors.grey.shade800 : Colors.grey.shade300,
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
                Icons.account_tree_outlined,
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
                  color: Colors.grey,
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
    final theme = Theme.of(context);

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
                color: _getStatusColor(node.status).withOpacity(0.1),
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: _getStatusColor(node.status).withOpacity(0.5),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _getStatusIcon(node.status),
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
                            color: theme.textTheme.bodyMedium?.color,
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
                              color: Colors.grey.shade600,
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
                        color: Colors.orange.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        'waiting ${node.waitingForThreadIds.length}',
                        style: TextStyle(
                          fontSize: compact ? 9 : 10,
                          color: Colors.orange.shade700,
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

  Color _getStatusColor(CodexCollabAgentStatus status) {
    switch (status) {
      case CodexCollabAgentStatus.pendingInit:
        return Colors.grey;
      case CodexCollabAgentStatus.running:
        return Colors.blue;
      case CodexCollabAgentStatus.completed:
        return Colors.green;
      case CodexCollabAgentStatus.errored:
        return Colors.red;
      case CodexCollabAgentStatus.shutdown:
        return Colors.orange;
      case CodexCollabAgentStatus.notFound:
        return Colors.grey;
    }
  }

  Widget _getStatusIcon(CodexCollabAgentStatus status) {
    final size = compact ? 14.0 : 16.0;
    switch (status) {
      case CodexCollabAgentStatus.pendingInit:
        return Icon(
          Icons.hourglass_empty,
          size: size,
          color: Colors.grey.shade600,
        );
      case CodexCollabAgentStatus.running:
        return SizedBox(
          width: size,
          height: size,
          child: const CircularProgressIndicator(strokeWidth: 2),
        );
      case CodexCollabAgentStatus.completed:
        return Icon(Icons.check_circle, size: size, color: Colors.green);
      case CodexCollabAgentStatus.errored:
        return Icon(Icons.error, size: size, color: Colors.red);
      case CodexCollabAgentStatus.shutdown:
        return Icon(
          Icons.stop_circle_outlined,
          size: size,
          color: Colors.orange,
        );
      case CodexCollabAgentStatus.notFound:
        return Icon(Icons.help_outline, size: size, color: Colors.grey);
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
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: theme.colorScheme.primaryContainer.withOpacity(0.3),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.account_tree_outlined,
              size: 12,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(width: 4),
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
              Icon(Icons.check, size: 12, color: Colors.green),
            const SizedBox(width: 4),
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
