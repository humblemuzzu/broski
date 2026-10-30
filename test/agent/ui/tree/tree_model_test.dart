import 'package:broski/agent/ui/panels/tree/tree_model.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

TreeNode _node(
  String id,
  TreeNodeKind kind, {
  String? parent,
  int at = 0,
  String? label,
}) => TreeNode(
  id: id,
  parentId: parent,
  itemId: '$id:0',
  kind: kind,
  at: at,
  preview: id,
  previewCut: false,
  label: label,
);

List<String> _ids(List<TreeRow> rows) => [for (final row in rows) row.node.id];

void main() {
  // u1 → a1 → u2 → a2 (the older branch)
  //          ↘ u3 → a3 → label (the session is here)
  final nodes = [
    _node('label', TreeNodeKind.label, parent: 'a3', at: 9),
    _node('a3', TreeNodeKind.assistant, parent: 'u3', at: 8),
    _node('u3', TreeNodeKind.user, parent: 'a1', at: 7),
    _node('a2', TreeNodeKind.assistant, parent: 'u2', at: 6),
    _node('tools', TreeNodeKind.assistantTools, parent: 'u2', at: 5),
    _node('u2', TreeNodeKind.user, parent: 'a1', at: 4),
    _node('a1', TreeNodeKind.assistant, parent: 'u1', at: 3, label: 'first'),
    _node('u1', TreeNodeKind.user, at: 1),
  ];

  test(
    'the older branch comes first, a branch point indents, a chain does not',
    () {
      final rows = treeRows(nodes, 'label', TreeFilter.standard);
      expect(_ids(rows), ['u1', 'a1', 'u2', 'a2', 'u3', 'a3']);
      expect([for (final row in rows) row.depth], [0, 0, 1, 1, 1, 1]);
    },
  );

  test('settings entries and tool-only replies are hidden, the position moves '
      'to the nearest shown node before it', () {
    final rows = treeRows(nodes, 'label', TreeFilter.standard);
    expect(_ids(rows), isNot(contains('label')));
    expect(_ids(rows), isNot(contains('tools')));
    expect(
      [
        for (final row in rows)
          if (row.current) row.node.id,
      ],
      ['a3'],
    );
    expect(
      [
        for (final row in rows)
          if (row.onPath) row.node.id,
      ],
      ['u1', 'a1', 'u3', 'a3'],
    );
  });

  test(
    'every filter shows what a terminal shows, a reply that only calls tools in none',
    () {
      expect(_ids(treeRows(nodes, 'label', TreeFilter.userOnly)), [
        'u1',
        'u2',
        'u3',
      ]);
      expect(_ids(treeRows(nodes, 'label', TreeFilter.labeledOnly)), ['a1']);
      expect(_ids(treeRows(nodes, 'label', TreeFilter.all)), [
        'u1',
        'a1',
        'u2',
        'a2',
        'u3',
        'a3',
        'label',
      ]);
    },
  );

  test('a node whose parent is not read yet is a root marked as cut above', () {
    final newest = [nodes[0], nodes[1], nodes[2]];
    final rows = treeRows(newest, 'label', TreeFilter.standard);
    expect(_ids(rows), ['u3', 'a3']);
    expect(rows.first.cutAbove, isTrue);
    expect(rows.last.cutAbove, isFalse);
  });

  test('a parent cycle ends instead of looping', () {
    final loop = [
      _node('x', TreeNodeKind.user, parent: 'y', at: 1),
      _node('y', TreeNodeKind.assistant, parent: 'x', at: 2),
    ];
    expect(treeRows(loop, 'y', TreeFilter.all), isEmpty);
  });

  test('a long chain is walked without recursion', () {
    final chain = [
      for (var i = 0; i < 20000; i++)
        _node(
          'n$i',
          TreeNodeKind.user,
          parent: i == 0 ? null : 'n${i - 1}',
          at: i,
        ),
    ];
    expect(treeRows(chain, 'n19999', TreeFilter.all), hasLength(20000));
  });
}
