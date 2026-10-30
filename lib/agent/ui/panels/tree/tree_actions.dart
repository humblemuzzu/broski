import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
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
  final choice = await showDialog<_Choice>(
    context: context,
    builder: (context) => SimpleDialog(
      title: Text(
        node.preview.isEmpty ? 'This entry' : node.preview,
        maxLines: 3,
        overflow: TextOverflow.ellipsis,
      ),
      children: [
        if (!isLeaf) ...[
          _option(
            'tree-continue',
            'Continue from here',
            _Choice.plain,
            context,
          ),
          _option(
            'tree-continue-summary',
            'Continue and summarise the branch I leave',
            _Choice.summarize,
            context,
          ),
          _option(
            'tree-continue-summary-with',
            'Summarise with my own prompt',
            _Choice.summarizeWith,
            context,
          ),
        ],
        _option(
          'tree-label',
          node.label == null ? 'Add a label' : 'Change the label',
          _Choice.label,
          context,
        ),
        if (node.label != null)
          _option(
            'tree-unlabel',
            'Remove the label',
            _Choice.clearLabel,
            context,
          ),
      ],
    ),
  );
  if (choice == null || !context.mounted) return null;
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

Widget _option(
  String key,
  String label,
  _Choice choice,
  BuildContext context,
) => SimpleDialogOption(
  key: ValueKey(key),
  onPressed: () => Navigator.of(context).pop(choice),
  child: Text(label),
);
