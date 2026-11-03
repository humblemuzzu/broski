import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/tree/tree_node_look.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:flutter/material.dart';

/// What the person chose to do with a node.
sealed class TreeAction {
  const TreeAction();
}

/// Move the session to the node, summarising the branch it leaves or not.
final class TreeContinue extends TreeAction {
  const TreeContinue({required this.summarize, this.instructions});

  final bool summarize;

  /// What the summary should stress; only with [summarize].
  final String? instructions;
}

/// Set the node's label; null clears it.
final class TreeLabel extends TreeAction {
  const TreeLabel(this.label);

  final String? label;
}

enum _Choice { plain, summarize, summarizeWith, label, clearLabel }

/// Asks what to do with [node]. Null when the person walks away.
Future<TreeAction?> chooseTreeAction(
  BuildContext context,
  TreeNode node, {
  required bool isLeaf,
}) async {
  final choice = await showModalBottomSheet<_Choice>(
    context: context,
    backgroundColor: Colors.transparent,
    constraints: Responsive.sheetConstraints(context),
    builder: (context) => _ActionSheet(node: node, isLeaf: isLeaf),
  );
  if (choice == null || !context.mounted) return null;
  return _actionFor(context, choice, node);
}

Future<TreeAction?> _actionFor(
  BuildContext context,
  _Choice choice,
  TreeNode node,
) async {
  switch (choice) {
    case _Choice.plain:
      return const TreeContinue(summarize: false);
    case _Choice.summarize:
      return const TreeContinue(summarize: true);
    case _Choice.summarizeWith:
      final text = await askForText(
        context,
        title: 'What should the summary stress?',
        action: 'Summarise',
      );
      return text == null
          ? null
          : TreeContinue(summarize: true, instructions: text);
    case _Choice.label:
      final text = await askForText(
        context,
        title: 'Label',
        action: 'Save',
        initial: node.label ?? '',
        allowEmpty: true,
      );
      return text == null ? null : TreeLabel(text.isEmpty ? null : text);
    case _Choice.clearLabel:
      return const TreeLabel(null);
  }
}

/// The ways to move the session to a node, or to name it.
class _ActionSheet extends StatelessWidget {
  const _ActionSheet({required this.node, required this.isLeaf});

  final TreeNode node;
  final bool isLeaf;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.sheetTop,
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          padding: const EdgeInsets.only(bottom: Spacing.md),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const _Handle(),
              _Header(node: node, theme: theme),
              if (!isLeaf) ..._continueChoices(theme),
              ..._labelChoices(theme),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _continueChoices(OpenCodeTheme theme) => [
    _ChoiceTile(
      key: const ValueKey('tree-continue'),
      icon: AppIcons.forward,
      label: 'Continue from here',
      subtitle: 'The conversation goes on from this point',
      color: theme.primary,
      choice: _Choice.plain,
    ),
    _ChoiceTile(
      key: const ValueKey('tree-continue-summary'),
      icon: AppIcons.compress,
      label: 'Continue and summarise the branch I leave',
      subtitle: 'The agent writes what it leaves behind',
      color: theme.info,
      choice: _Choice.summarize,
    ),
    _ChoiceTile(
      key: const ValueKey('tree-continue-summary-with'),
      icon: AppIcons.edit,
      label: 'Summarise with my own prompt',
      subtitle: 'You say what the summary should stress',
      color: theme.accent,
      choice: _Choice.summarizeWith,
    ),
  ];

  List<Widget> _labelChoices(OpenCodeTheme theme) => [
    _ChoiceTile(
      key: const ValueKey('tree-label'),
      icon: AppIcons.star,
      label: node.label == null ? 'Add a label' : 'Change the label',
      subtitle: 'A name you can find this point by',
      color: theme.warning,
      choice: _Choice.label,
    ),
    if (node.label != null)
      _ChoiceTile(
        key: const ValueKey('tree-unlabel'),
        icon: AppIcons.unlink,
        label: 'Remove the label',
        subtitle: 'The point keeps no name',
        color: theme.error,
        choice: _Choice.clearLabel,
      ),
  ];
}

class _Header extends StatelessWidget {
  const _Header({required this.node, required this.theme});

  final TreeNode node;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(Spacing.lg, 0, Spacing.lg, Spacing.sm),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: treeNodeKindLabel(node.kind).toUpperCase(),
          theme: theme,
        ),
        const SizedBox(height: Spacing.xs),
        Text(
          node.preview.isEmpty ? 'This entry' : treeNodeText(node),
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
          style: AppTypography.bodyLarge(color: theme.text),
        ),
      ],
    ),
  );
}

class _Handle extends StatelessWidget {
  const _Handle();

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: Spacing.md, bottom: Spacing.sm),
    child: Center(
      child: Container(
        width: 40,
        height: 4,
        decoration: BoxDecoration(
          color: OpenCodeTheme.of(context).textMuted.withValues(alpha: 0.3),
          borderRadius: Radii.brXs,
        ),
      ),
    ),
  );
}

class _ChoiceTile extends StatelessWidget {
  const _ChoiceTile({
    super.key,
    required this.icon,
    required this.label,
    required this.subtitle,
    required this.color,
    required this.choice,
  });

  final IconData icon;
  final String label;
  final String subtitle;
  final Color color;
  final _Choice choice;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: Spacing.md, vertical: 3),
      child: Material(
        color: theme.backgroundElement,
        borderRadius: Radii.brSm,
        child: InkWell(
          borderRadius: Radii.brSm,
          onTap: () => Navigator.of(context).pop(choice),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
            child: Row(
              children: [
                Icon(icon, size: 18, color: color),
                const SizedBox(width: Spacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: AppTypography.labelLarge(color: theme.text),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        subtitle,
                        style: AppTypography.caption(color: theme.textMuted),
                      ),
                    ],
                  ),
                ),
                Icon(AppIcons.chevronRight, size: 14, color: theme.textMuted),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
