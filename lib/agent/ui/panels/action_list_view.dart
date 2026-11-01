import 'package:broski/agent/ui/panels/grouping.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/agent/ui/panels/pill.dart';
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
/// the rows under the group they name, each with its state in the colour of
/// its tone, its badges and its actions; what was left out; the list's note.
/// [change] takes an action on a row (a destructive one is confirmed first),
/// [reload] reads the list again, [onOpenRow] opens a row. A control that is
/// not given is not offered.
class ActionListView extends StatelessWidget {
  const ActionListView({
    super.key,
    required this.list,
    required this.actions,
    this.change,
    this.reload,
    this.onOpenRow,
  });

  final ActionList list;
  final ResultActions actions;
  final ListActionCall? change;
  final BackendCall Function(OpTarget target)? reload;
  final ValueChanged<ActionListRow>? onOpenRow;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final muted = AppTypography.bodySmall(color: theme.textMuted);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (actions.busy)
          const LinearProgressIndicator(
            key: ValueKey('action-list-busy'),
            minHeight: 2,
            semanticsLabel: 'Working',
          ),
        if (reload case final reload?)
          _Refresh(actions: actions, reload: reload),
        if (list.rows.isEmpty) Text('Nothing to show.', style: muted),
        for (final section in groupedInOrder(
          list.rows,
          (row) => row.group,
        )) ...[
          if (section.group case final group?)
            Padding(
              padding: Insets.section,
              child: Text(
                group,
                key: ValueKey('action-group:$group'),
                style: AppTypography.labelLarge(),
              ),
            ),
          for (final row in section.items)
            _RowView(
              row: row,
              actions: actions,
              change: change,
              onOpen: onOpenRow,
            ),
        ],
        if (list.omitted > 0) _Omitted(count: list.omitted),
        if (list.note case final note?) _Note(text: note),
      ],
    );
  }
}

class _Refresh extends StatelessWidget {
  const _Refresh({required this.actions, required this.reload});

  final ResultActions actions;
  final BackendCall Function(OpTarget target) reload;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerRight,
    child: TextButton.icon(
      key: const ValueKey('action-list-refresh'),
      onPressed: actions.busy ? null : () => actions.call(reload),
      icon: const Icon(Icons.refresh, size: 16),
      label: const Text('Refresh'),
    ),
  );
}

class _Omitted extends StatelessWidget {
  const _Omitted({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => Padding(
    key: const ValueKey('action-list-omitted'),
    padding: Insets.chipV,
    child: Text(
      '$count more ${count == 1 ? 'is' : 'are'} not shown: the list is at '
      'its limit.',
      style: AppTypography.bodySmall(
        color: OpenCodeTheme.of(context).textMuted,
      ),
    ),
  );
}

class _Note extends StatelessWidget {
  const _Note({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      key: const ValueKey('action-list-note'),
      margin: Insets.topSm,
      padding: Insets.cardSm,
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brSm,
      ),
      child: SelectableText(text, style: AppTypography.codeSmall()),
    );
  }
}

class _RowView extends StatelessWidget {
  const _RowView({
    required this.row,
    required this.actions,
    this.change,
    this.onOpen,
  });

  final ActionListRow row;
  final ResultActions actions;
  final ListActionCall? change;
  final ValueChanged<ActionListRow>? onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final status = row.status;
    final open = onOpen;
    return Column(
      key: ValueKey('action-row:${row.id}'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        InkWell(
          key: ValueKey('open-row:${row.id}'),
          onTap: open == null || actions.busy ? null : () => open(row),
          child: Padding(
            padding: Insets.chipV,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: _Details(row: row)),
                if (status != null) ...[
                  const SizedBox(width: Spacing.sm),
                  Pill(
                    text: status.label,
                    color: _toneColor(theme, status.tone),
                  ),
                ],
                if (open != null)
                  Icon(Icons.chevron_right, color: theme.textMuted),
              ],
            ),
          ),
        ),
        if (change case final change? when row.actions.isNotEmpty)
          Wrap(
            spacing: Spacing.sm,
            children: [
              for (final action in row.actions)
                TextButton(
                  key: ValueKey('row-action:${row.id}:${action.id}'),
                  style: action.destructive
                      ? TextButton.styleFrom(foregroundColor: theme.error)
                      : null,
                  onPressed: actions.busy
                      ? null
                      : () => _take(context, action, change),
                  child: Text(action.label),
                ),
            ],
          ),
        Divider(height: 1, color: theme.borderSubtle),
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
          body: action.confirm ?? 'The Mac does this as soon as you confirm.',
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

class _Details extends StatelessWidget {
  const _Details({required this.row});

  final ActionListRow row;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(row.title, style: AppTypography.body(color: theme.text)),
        if (row.subtitle case final subtitle?)
          Text(
            subtitle,
            style: AppTypography.bodySmall(color: theme.textMuted),
          ),
        if (row.badges.isNotEmpty)
          Padding(
            padding: Insets.topSm,
            child: Wrap(
              spacing: Spacing.xs,
              runSpacing: Spacing.xs,
              children: [
                for (final badge in row.badges)
                  Pill(text: badge, color: theme.textMuted),
              ],
            ),
          ),
      ],
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
