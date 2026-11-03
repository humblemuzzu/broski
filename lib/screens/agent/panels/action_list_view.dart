import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/grouping.dart';
import 'package:broski/screens/agent/panels/op_panel.dart';
import 'package:broski/screens/agent/panels/panel_card.dart';
import 'package:broski/screens/agent/panels/pill.dart';
import 'package:broski/screens/agent/panels/result_actions.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/screens/agent/shared/tinted_button.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/section_header.dart' show SectionHeader;
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
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (actions.busy) const _BusyBar(),
        if (reload case final reload?)
          _RefreshRow(actions: actions, reload: reload),
        if (list.rows.isEmpty)
          Padding(
            padding: Insets.chipV,
            child: Text(
              'Nothing to show.',
              style: AppTypography.bodySmall(color: theme.textMuted),
            ),
          ),
        for (final section in groupedInOrder(list.rows, (row) => row.group))
          _Section(
            group: section.group,
            rows: section.items,
            actions: actions,
            change: change,
            onOpen: onOpenRow,
          ),
        if (list.omitted > 0) _Omitted(count: list.omitted),
        if (list.note case final note?) _Note(text: note),
      ],
    );
  }
}

class _BusyBar extends StatelessWidget {
  const _BusyBar();

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.bottomSm,
      child: ClipRRect(
        borderRadius: Radii.brXs,
        child: LinearProgressIndicator(
          key: const ValueKey('action-list-busy'),
          minHeight: 2,
          color: theme.primary,
          backgroundColor: theme.backgroundElement,
          semanticsLabel: 'Working',
        ),
      ),
    );
  }
}

class _RefreshRow extends StatelessWidget {
  const _RefreshRow({required this.actions, required this.reload});

  final ResultActions actions;
  final BackendCall Function(OpTarget target) reload;

  @override
  Widget build(BuildContext context) => Align(
    alignment: Alignment.centerRight,
    child: Padding(
      padding: Insets.bottomSm,
      child: TintedButton(
        key: const ValueKey('action-list-refresh'),
        icon: AppIcons.refresh,
        label: 'Refresh',
        onTap: actions.busy ? null : () => actions.call(reload),
      ),
    ),
  );
}

/// One group of rows under the name it carries, or without a title when it
/// has no name.
class _Section extends StatelessWidget {
  const _Section({
    required this.group,
    required this.rows,
    required this.actions,
    this.change,
    this.onOpen,
  });

  final String? group;
  final List<ActionListRow> rows;
  final ResultActions actions;
  final ListActionCall? change;
  final ValueChanged<ActionListRow>? onOpen;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (group case final group?)
          Padding(
            padding: Insets.bottomSm,
            child: SectionHeader(
              key: ValueKey('action-group:$group'),
              title: group,
              theme: theme,
            ),
          ),
        for (final row in rows)
          Padding(
            padding: Insets.bottomMd,
            child: _RowView(
              row: row,
              actions: actions,
              change: change,
              onOpen: onOpen,
            ),
          ),
      ],
    );
  }
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
      style: AppTypography.label(color: OpenCodeTheme.of(context).textMuted),
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
        border: Border.all(color: theme.borderSubtle),
      ),
      child: SelectableText(
        text,
        style: AppTypography.codeSmall(color: theme.text),
      ),
    );
  }
}

/// One row of the list: what it is, what state it is in, and what may be done
/// with it.
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
    final change = this.change;
    return PanelCard(
      key: ValueKey('action-row:${row.id}'),
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          GestureDetector(
            key: ValueKey('open-row:${row.id}'),
            onTap: open == null || actions.busy ? null : () => open(row),
            behavior: HitTestBehavior.opaque,
            child: Padding(
              padding: Insets.cardSm,
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
                    Padding(
                      padding: Insets.chipH,
                      child: Icon(
                        AppIcons.chevronRight,
                        size: 18,
                        color: theme.textMuted,
                      ),
                    ),
                ],
              ),
            ),
          ),
          if (change != null && row.actions.isNotEmpty)
            _RowActions(row: row, actions: actions, change: change),
        ],
      ),
    );
  }
}

/// What one row may be made to do, each its own capsule at the foot of it.
class _RowActions extends StatelessWidget {
  const _RowActions({
    required this.row,
    required this.actions,
    required this.change,
  });

  final ActionListRow row;
  final ResultActions actions;
  final ListActionCall change;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(Spacing.md, 0, Spacing.md, Spacing.sm),
      child: Wrap(
        spacing: Spacing.sm,
        runSpacing: Spacing.sm,
        children: [
          for (final action in row.actions)
            TextButton(
              key: ValueKey('row-action:${row.id}:${action.id}'),
              style: _style(theme, action),
              onPressed: actions.busy
                  ? null
                  : () => _take(context, action, change),
              child: Text(action.label),
            ),
        ],
      ),
    );
  }

  ButtonStyle _style(OpenCodeTheme theme, ActionListAction action) {
    final tone = action.destructive ? theme.error : theme.primary;
    return TextButton.styleFrom(
      foregroundColor: tone,
      disabledForegroundColor: theme.textMuted,
      backgroundColor: tone.withValues(alpha: 0.1),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      minimumSize: Size.zero,
      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      textStyle: AppTypography.label(color: tone),
      shape: RoundedRectangleBorder(
        borderRadius: Radii.brSm,
        side: BorderSide(color: tone.withValues(alpha: 0.3)),
      ),
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
        Text(
          row.title,
          style: AppTypography.bodySmall(
            color: theme.text,
          ).copyWith(fontSize: 14, fontWeight: FontWeight.w500),
        ),
        if (row.subtitle case final subtitle?)
          Padding(
            padding: Insets.topSm,
            child: Text(
              subtitle,
              style: AppTypography.label(color: theme.textMuted),
            ),
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
