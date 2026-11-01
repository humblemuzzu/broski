import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/catalog/session_actions.dart';
import 'package:broski/agent/catalog/session_list_controller.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/sessions/child_sessions_screen.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The actions a row allows, as a bottom sheet; each runs on tap.
Future<void> showSessionActions(
  BuildContext context,
  WidgetRef ref, {
  required SessionSummary row,
  required BackendDescriptor backend,
  required SessionListKey listKey,
}) async {
  final actions = rowActions(row, backend.capabilities);
  final chosen = await showModalBottomSheet<RowAction>(
    context: context,
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final action in actions)
            ListTile(
              key: ValueKey('row-action:${action.name}'),
              leading: Icon(_icon(action)),
              title: Text(_label(action)),
              onTap: () => Navigator.of(context).pop(action),
            ),
        ],
      ),
    ),
  );
  if (chosen == null || !context.mounted) return;
  await _run(context, ref, chosen, row, backend, listKey);
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
      final list = ref.read(sessionListProvider(listKey).notifier);
      await _delete(context, actions, session, list);
    case RowAction.fork:
      await _fork(context, actions, session);
    case RowAction.children:
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => ChildSessionsScreen(backend: backend, parent: row),
        ),
      );
  }
}

Future<void> _delete(
  BuildContext context,
  SessionActions actions,
  SessionRef session,
  SessionListController list,
) async {
  final sure = await askToConfirm(
    context,
    title: 'Delete this session?',
    body: 'Its history is removed from the Mac too.',
    action: 'Delete',
  );
  if (!sure) return;
  final problem = await actions.delete(session, list);
  if (context.mounted) showProblem(context, problem);
}

Future<void> _fork(
  BuildContext context,
  SessionActions actions,
  SessionRef session,
) async {
  final outcome = await actions.fork(session);
  if (!context.mounted) return;
  if (outcome case Done(value: final forked)) {
    await openSession(context, forked);
  } else {
    showProblem(context, problemOf(outcome));
  }
}

String _label(RowAction action) => switch (action) {
  RowAction.rename => 'Rename',
  RowAction.fork => 'Fork',
  RowAction.archive => 'Archive',
  RowAction.unarchive => 'Unarchive',
  RowAction.delete => 'Delete',
  RowAction.children => 'Subagents',
};

IconData _icon(RowAction action) => switch (action) {
  RowAction.rename => AppIcons.edit,
  RowAction.fork => AppIcons.gitFork,
  RowAction.archive => AppIcons.archive,
  RowAction.unarchive => AppIcons.unarchive,
  RowAction.delete => AppIcons.delete,
  RowAction.children => AppIcons.agent,
};
