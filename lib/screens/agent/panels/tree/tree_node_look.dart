import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/tree/tree_model.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// How the tree marks the position the session stands at.
const treeHereLabel = 'you are here';

/// What a node's role is drawn with: its icon and its colour.
(IconData, Color) treeNodeLook(TreeNodeKind kind, OpenCodeTheme theme) =>
    switch (kind) {
      TreeNodeKind.user => (AppIcons.chatBubble, theme.info),
      TreeNodeKind.assistant => (AppIcons.smartToy, theme.primary),
      TreeNodeKind.assistantTools => (AppIcons.tools, theme.toolRead),
      TreeNodeKind.toolResult => (AppIcons.terminal, theme.toolBash),
      TreeNodeKind.bash => (AppIcons.terminal, theme.toolBash),
      TreeNodeKind.customMessage => (AppIcons.extension_, theme.accent),
      TreeNodeKind.compaction => (AppIcons.compress, theme.warning),
      TreeNodeKind.branchSummary => (AppIcons.description, theme.textMuted),
      TreeNodeKind.modelChange => (AppIcons.tune, theme.textMuted),
      TreeNodeKind.thinkingChange => (AppIcons.brain, theme.textMuted),
      TreeNodeKind.sessionInfo => (AppIcons.info, theme.textMuted),
      TreeNodeKind.label => (AppIcons.star, theme.warning),
      TreeNodeKind.custom => (AppIcons.code, theme.textMuted),
      TreeNodeKind.contextEdit => (AppIcons.fileEdit, theme.textMuted),
    };

/// What a node is, in a word or two.
String treeNodeKindLabel(TreeNodeKind kind) => switch (kind) {
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

/// The node's text on one line, whatever whitespace the backend sent.
String treeNodeText(TreeNode node) =>
    node.preview.replaceAll(RegExp(r'\s+'), ' ').trim();

/// The row as a screen reader says it: what it is, where the session is, what
/// it says and its label, in one phrase.
String treeRowSpoken(TreeRow row) => [
  treeNodeKindLabel(row.node.kind),
  if (row.current) treeHereLabel,
  treeNodeText(row.node),
  if (row.node.label case final label?) 'label $label',
].join(', ');
