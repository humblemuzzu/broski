import 'package:broski/agent/ui/panels/tree/tree_model.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One node of the tree: what it is, what it says, its label, and whether the
/// session stands on it.
class TreeRowTile extends StatelessWidget {
  const TreeRowTile({super.key, required this.row, required this.onTap});

  final TreeRow row;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final node = row.node;
    return InkWell(
      key: ValueKey('tree-node:${node.id}'),
      onTap: onTap,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          Spacing.md + 14.0 * row.depth.clamp(0, 12),
          Spacing.xs,
          Spacing.md,
          Spacing.xs,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              row.current ? AppIcons.chevronRight : AppIcons.gitBranch,
              size: 14,
              color: row.current
                  ? theme.primary
                  : row.onPath
                  ? theme.text
                  : theme.textMuted,
            ),
            const SizedBox(width: Spacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${row.cutAbove ? '… ' : ''}${_kind(node.kind)}'
                    '${row.current ? ' · you are here' : ''}',
                    style: AppTypography.caption(
                      color: row.current ? theme.primary : theme.textMuted,
                    ),
                  ),
                  Text(
                    node.preview.replaceAll(RegExp(r'\s+'), ' ').trim(),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppTypography.bodySmall(
                      color: row.onPath ? theme.text : theme.textMuted,
                    ),
                  ),
                  if (node.label case final label?)
                    Text(
                      '#$label',
                      style: AppTypography.caption(color: theme.primary),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String _kind(TreeNodeKind kind) => switch (kind) {
  TreeNodeKind.user => 'You',
  TreeNodeKind.assistant => 'Assistant',
  TreeNodeKind.assistantTools => 'Assistant (tools)',
  TreeNodeKind.toolResult => 'Tool result',
  TreeNodeKind.bash => 'Command',
  TreeNodeKind.customMessage => 'Extension message',
  TreeNodeKind.compaction => 'Compaction',
  TreeNodeKind.branchSummary => 'Branch summary',
  TreeNodeKind.modelChange => 'Model',
  TreeNodeKind.thinkingChange => 'Thinking',
  TreeNodeKind.sessionInfo => 'Title',
  TreeNodeKind.label => 'Label',
  TreeNodeKind.custom => 'Entry',
  TreeNodeKind.contextEdit => 'Context edit',
};
