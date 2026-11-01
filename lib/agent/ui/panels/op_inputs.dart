/// What each backend operation asks the person before it is called. The
/// call's type is the contract's own, wrapped for the backend of the session
/// it is run on (`opCall`).
library;

import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';

Future<BackendCall?> askRewindFiles(
  BuildContext context,
  OpTarget target,
) async {
  final itemId = target.itemId;
  if (itemId == null) return null;
  final dryRun = await _choose(
    context,
    title: 'Rewind files to this message?',
    body: 'The conversation stays; files edited since go back.',
    options: const {'Preview the rewind': true, 'Rewind now': false},
  );
  if (dryRun == null) return null;
  return opCall(
    target.session,
    RewindFilesOp(
      sessionId: target.session.sessionId,
      userItemId: itemId,
      dryRun: dryRun,
    ),
  );
}

Future<BackendCall?> askNavigateTree(
  BuildContext context,
  OpTarget target,
) async {
  final itemId = target.itemId;
  if (itemId == null) return null;
  final summarize = await _choose(
    context,
    title: 'Continue from here?',
    body:
        'The conversation goes on from this point; what came after stays in the file.',
    options: const {'Summarise what is left': true, 'Leave it as it is': false},
  );
  if (summarize == null) return null;
  return opCall(
    target.session,
    NavigateTreeOp(
      sessionId: target.session.sessionId,
      itemId: itemId,
      summarize: summarize,
    ),
  );
}

Future<BackendCall?> askTakeOver(BuildContext context, OpTarget target) async {
  final sure = await askToConfirm(
    context,
    title: 'Take over this session?',
    body:
        'Make sure no terminal is using this session. If it is open in a '
        'terminal, close it there first: two programs writing one session '
        'can corrupt it. Broski then runs the session from your phone.',
    action: 'Take over',
  );
  return sure
      ? opCall(target.session, TakeOverOp(sessionId: target.session.sessionId))
      : null;
}

Future<BackendCall?> askExportSession(
  BuildContext context,
  OpTarget target,
) async {
  final format = await _choose(
    context,
    title: 'Export this session as',
    body: 'The Mac writes it aside and sends it here to share.',
    options: const {
      'A web page (HTML)': SessionExportFormat.html,
      'The session file (JSONL)': SessionExportFormat.jsonl,
    },
  );
  return format == null
      ? null
      : opCall(
          target.session,
          ExportSessionOp(sessionId: target.session.sessionId, format: format),
        );
}

Future<BackendCall?> askChangedFiles(
  BuildContext context,
  OpTarget target,
) async =>
    opCall(target.session, ChangedFilesOp(sessionId: target.session.sessionId));

Future<BackendCall?> askRefreshModels(
  BuildContext context,
  OpTarget target,
) async => opCall(target.session, const RefreshModelsOp());

/// For a panel that is run by its `flow`, or never run on its own.
Future<BackendCall?> askNothing(BuildContext context, OpTarget target) async =>
    null;

Future<T?> _choose<T>(
  BuildContext context, {
  required String title,
  required String body,
  required Map<String, T> options,
}) => showDialog<T>(
  context: context,
  builder: (context) => SimpleDialog(
    title: Text(title),
    children: [
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24),
        child: Text(body),
      ),
      for (final MapEntry(key: label, :value) in options.entries)
        SimpleDialogOption(
          onPressed: () => Navigator.of(context).pop(value),
          child: Text(label),
        ),
    ],
  ),
);
