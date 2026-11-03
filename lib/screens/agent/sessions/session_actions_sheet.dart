import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/session_actions.dart';
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/screens/agent/sessions/child_sessions_screen.dart';
import 'package:broski/screens/agent/sessions/session_openers.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/action_row.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The actions a row allows, as the app's action sheet; each row of the sheet
/// says what it does and runs it on tap. Highlighting is offered with them,
/// since it is the app's own mark rather than something the backend does.
Future<void> showSessionActions(
  BuildContext context,
  WidgetRef ref, {
  required SessionSummary row,
  required BackendDescriptor backend,
  required SessionListKey listKey,
}) async {
  final chosen = await DetailSheet.show<RowAction>(
    context: context,
    title: row.title?.text ?? 'Untitled session',
    initialSize: 0.5,
    maxSize: 0.85,
    child: _ActionSheet(row: row, backend: backend),
  );
  if (chosen == null || !context.mounted) return;
  await _run(context, ref, chosen, row, backend, listKey);
}

/// The rows of the action sheet: what the backend allows, then the app's own
/// mark. Each pops the sheet with the action it chose, or with nothing where
/// it already did its work.
class _ActionSheet extends ConsumerWidget {
  const _ActionSheet({required this.row, required this.backend});

  final SessionSummary row;
  final BackendDescriptor backend;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final highlighted = ref
        .watch(highlightsProvider)
        .isSessionHighlighted(row.session.sessionId);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final action in rowActions(row, backend.capabilities))
          Padding(
            padding: Insets.bottomSm,
            child: ActionRow(
              key: ValueKey('row-action:${action.name}'),
              icon: _icon(action),
              label: _label(action),
              subtitle: _subtitle(action),
              theme: theme,
              color: action == RowAction.delete ? theme.error : null,
              onTap: () => Navigator.of(context).pop(action),
            ),
          ),
        Padding(
          padding: Insets.bottomSm,
          child: ActionRow(
            key: const ValueKey('row-action:highlight'),
            icon: highlighted ? AppIcons.star : AppIcons.starOutline,
            label: highlighted ? 'Remove highlight' : 'Highlight',
            subtitle: 'Keep it at the top of the list',
            theme: theme,
            onTap: () {
              Navigator.of(context).pop();
              ref
                  .read(highlightsProvider.notifier)
                  .toggleSession(row.session.sessionId);
            },
          ),
        ),
        const SizedBox(height: Spacing.lg),
      ],
    );
  }
}

/// Asks before removing a session and removes it, telling the list at once:
/// the same question whether the person swiped the row or picked Delete.
Future<void> deleteSession(
  BuildContext context,
  WidgetRef ref, {
  required SessionSummary row,
  required SessionListKey listKey,
}) async {
  final sure = await askToConfirm(
    context,
    title: 'Delete this session?',
    body: 'Its history is removed from the Mac too.',
    action: 'Delete',
  );
  if (!sure || !context.mounted) return;
  final problem = await SessionActions(
    ref.read(contractClientProvider),
  ).delete(row.session, ref.read(sessionListProvider(listKey).notifier));
  if (context.mounted) showProblem(context, problem);
}

Future<void> _run(
  BuildContext context,
  WidgetRef ref,
  RowAction action,
  SessionSummary row,
  BackendDescriptor backend,
  SessionListKey listKey,
) async {
  final actions = SessionActions(ref.read(contractClientProvider));
  final session = row.session;
  switch (action) {
    case RowAction.rename:
      final title = await askForText(
        context,
        title: 'Rename',
        action: 'Rename',
        initial: row.title?.text ?? '',
      );
      if (title == null) return;
      final problem = await actions.rename(session, title);
      if (context.mounted) showProblem(context, problem);
    case RowAction.archive || RowAction.unarchive:
      final archived = action == RowAction.archive;
      final problem = await actions.setArchived(session, archived: archived);
      if (context.mounted) showProblem(context, problem);
    case RowAction.delete:
      if (context.mounted) {
        await deleteSession(context, ref, row: row, listKey: listKey);
      }
    case RowAction.fork:
      await openAsFork(context, ref, session);
    case RowAction.children:
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ChildSessionsScreen(backend: backend, parent: row),
        ),
      );
  }
}

String _label(RowAction action) => switch (action) {
  RowAction.rename => 'Rename',
  RowAction.fork => 'Open as fork',
  RowAction.archive => 'Archive',
  RowAction.unarchive => 'Unarchive',
  RowAction.delete => 'Delete',
  RowAction.children => 'Subagents',
};

String _subtitle(RowAction action) => switch (action) {
  RowAction.rename => 'Set a name of your own',
  RowAction.fork => 'The original stays as it is',
  RowAction.archive => 'Keep it out of the list',
  RowAction.unarchive => 'Put it back in the list',
  RowAction.delete => 'Remove it from the Mac too',
  RowAction.children => 'The sessions its subagents ran',
};

IconData _icon(RowAction action) => switch (action) {
  RowAction.rename => AppIcons.edit,
  RowAction.fork => AppIcons.gitFork,
  RowAction.archive => AppIcons.archive,
  RowAction.unarchive => AppIcons.unarchive,
  RowAction.delete => AppIcons.delete,
  RowAction.children => AppIcons.agent,
};
