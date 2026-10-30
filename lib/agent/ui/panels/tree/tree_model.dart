import 'package:broski/contract/generated/contract.dart';

/// Which nodes of a session's tree are shown, as a terminal's tree offers
/// them: the usual ones, without tool results, only what the person said,
/// only what carries a label, or everything the file holds.
enum TreeFilter {
  standard('Default'),
  noTools('No tools'),
  userOnly('User only'),
  labeledOnly('Labeled'),
  all('All');

  const TreeFilter(this.label);

  final String label;
}

/// One shown node, where it sits and how it relates to the position the
/// session is at.
final class TreeRow {
  const TreeRow({
    required this.node,
    required this.depth,
    required this.onPath,
    required this.current,
    required this.cutAbove,
  });

  final TreeNode node;

  /// Indent steps: a node is indented only when it is one of several
  /// branches, so a long chain stays flat.
  final int depth;

  /// The node lies on the way from the first message to the position the
  /// session is at.
  final bool onPath;

  /// The position the session is at, or the nearest shown node before it.
  final bool current;

  /// The node's parent has not been read yet: earlier pages hold it.
  final bool cutAbove;
}

const _settings = {
  TreeNodeKind.label,
  TreeNodeKind.contextEdit,
  TreeNodeKind.custom,
  TreeNodeKind.modelChange,
  TreeNodeKind.thinkingChange,
  TreeNodeKind.sessionInfo,
};

bool _shown(TreeNode node, TreeFilter filter, bool isLeaf) {
  if (node.kind == TreeNodeKind.assistantTools && !isLeaf) return false;
  final setting = _settings.contains(node.kind);
  return switch (filter) {
    TreeFilter.userOnly => node.kind == TreeNodeKind.user,
    TreeFilter.noTools => !setting && node.kind != TreeNodeKind.toolResult,
    TreeFilter.labeledOnly => node.label != null,
    TreeFilter.all => true,
    TreeFilter.standard => !setting,
  };
}

/// The rows of [nodes] (any order, possibly only the newest pages of a big
/// tree) under [filter]: depth first, the older branch first, a hidden node's
/// children attached to its nearest shown ancestor. [leafId] marks the
/// position the session is at.
List<TreeRow> treeRows(
  List<TreeNode> nodes,
  String? leafId,
  TreeFilter filter,
) {
  final byId = {for (final node in nodes) node.id: node};
  final path = <String>{};
  for (var at = leafId; at != null && path.add(at); at = byId[at]?.parentId) {}
  final shown = {
    for (final node in nodes)
      if (_shown(node, filter, node.id == leafId)) node.id,
  };
  String? shownParent(TreeNode node) {
    final seen = <String>{node.id};
    for (
      var at = node.parentId;
      at != null && seen.add(at);
      at = byId[at]?.parentId
    ) {
      if (shown.contains(at)) return at;
      if (!byId.containsKey(at)) return null;
    }
    return null;
  }

  final children = <String?, List<TreeNode>>{};
  for (final node in nodes) {
    if (shown.contains(node.id)) {
      (children[shownParent(node)] ??= []).add(node);
    }
  }
  for (final list in children.values) {
    list.sort((a, b) => (a.at ?? 0).compareTo(b.at ?? 0));
  }
  var current = leafId;
  while (current != null && !shown.contains(current)) {
    current = byId[current]?.parentId;
  }
  final rows = <TreeRow>[];
  final pending = <(TreeNode, int)>[
    for (final root in (children[null] ?? const <TreeNode>[]).reversed)
      (root, 0),
  ];
  while (pending.isNotEmpty) {
    final (node, depth) = pending.removeLast();
    rows.add(
      TreeRow(
        node: node,
        depth: depth,
        onPath: path.contains(node.id),
        current: node.id == current,
        cutAbove: node.parentId != null && !byId.containsKey(node.parentId),
      ),
    );
    final below = children[node.id] ?? const <TreeNode>[];
    for (final child in below.reversed) {
      pending.add((child, depth + (below.length > 1 ? 1 : 0)));
    }
  }
  return rows;
}
