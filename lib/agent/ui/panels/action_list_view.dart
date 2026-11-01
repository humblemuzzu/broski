import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Builds the call that takes one action on a row of the list shown.
typedef ListActionCall =
    BackendCall Function(OpTarget target, ActionListChange change);

/// Any list a backend answers with (contract `ActionList`), by its shape:
/// each row with its state, badges and actions, under the group it names,
/// then what was left out and the list's note. Without [change] the list is
/// only read and offers no action.
class ActionListView extends StatelessWidget {
  const ActionListView({
    super.key,
    required this.list,
    required this.actions,
    this.change,
  });

  final ActionList list;
  final ResultActions actions;
  final ListActionCall? change;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final muted = AppTypography.bodySmall(color: theme.textMuted);
    final rows = list.rows;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (rows.isEmpty) Text('Nothing to show.', style: muted),
        for (final (index, row) in rows.indexed) ...[
          if (row.group case final group?
              when index == 0 || rows[index - 1].group != group)
            Padding(
              padding: Insets.section,
              child: Text(group, style: AppTypography.labelLarge()),
            ),
          _RowView(row: row, actions: actions, change: change),
        ],
        if (list.omitted > 0)
          Text('${list.omitted} more not listed.', style: muted),
        if (list.note case final note?)
          Padding(
            key: const ValueKey('action-list-note'),
            padding: Insets.section,
            child: SelectableText(note),
          ),
      ],
    );
  }
}

class _RowView extends StatelessWidget {
  const _RowView({required this.row, required this.actions, this.change});

  final ActionListRow row;
  final ResultActions actions;
  final ListActionCall? change;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final details = [
      ?row.subtitle,
      if (row.badges.isNotEmpty) row.badges.join(' · '),
    ];
    return Column(
      key: ValueKey('action-row:${row.id}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(row.title),
          subtitle: details.isEmpty ? null : Text(details.join('\n')),
          trailing: row.status == null
              ? null
              : Text(
                  row.status!.label,
                  style: AppTypography.bodySmall(
                    color: _toneColor(theme, row.status!.tone),
                  ),
                ),
        ),
        if (change case final change? when row.actions.isNotEmpty)
          Wrap(
            spacing: 8,
            children: [
              for (final action in row.actions)
                TextButton(
                  key: ValueKey('row-action:${row.id}:${action.id}'),
                  onPressed: actions.busy
                      ? null
                      : () => _take(context, action, change),
                  child: Text(action.label),
                ),
            ],
          ),
      ],
    );
  }

  Future<void> _take(
    BuildContext context,
    ActionListAction action,
    ListActionCall change,
  ) async {
    if (action.destructive &&
        !await askToConfirm(
          context,
          title: '${action.label}: ${row.title}?',
          body: 'This cannot be undone.',
          action: action.label,
        )) {
      return;
    }
    await actions.call(
      (target) =>
          change(target, ActionListChange(rowId: row.id, actionId: action.id)),
    );
  }
}

Color _toneColor(OpenCodeTheme theme, ActionListTone tone) => switch (tone) {
  ActionListTone.neutral => theme.textMuted,
  ActionListTone.ok => theme.success,
  ActionListTone.busy => theme.info,
  ActionListTone.warning => theme.warning,
  ActionListTone.error => theme.error,
};
