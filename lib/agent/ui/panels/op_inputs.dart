/// What each backend operation asks the person before it is called. The
/// call's type is the contract's own: each operation belongs to one backend's
/// union (contract §13), and only that backend lists it in `backendOps`.
library;

import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';

Future<BackendCall?> askRewindFiles(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? itemId,
) async {
  if (itemId == null) return null;
  final dryRun = await _choose(
    context,
    title: 'Rewind files to this message?',
    body: 'The conversation stays; files edited since go back.',
    options: const {'Preview the rewind': true, 'Rewind now': false},
  );
  if (dryRun == null) return null;
  return ClaudeCodeCall(
    op: RewindFilesOp(sessionId: sessionId, userItemId: itemId, dryRun: dryRun),
  );
}

Future<BackendCall?> askNavigateTree(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? itemId,
) async {
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
    NavigateTreeOp(sessionId: sessionId, itemId: itemId, summarize: summarize),
  );
}

Future<BackendCall?> askTakeOver(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async {
  final sure = await askToConfirm(
    context,
    title: 'Take over this session?',
    body:
        'Make sure no terminal is using this session. If it is open in a '
        'terminal, close it there first: two programs writing one session '
        'can corrupt it. Broski then runs the session from your phone.',
    action: 'Take over',
  );
  return sure ? opCall(TakeOverOp(sessionId: sessionId)) : null;
}

Future<BackendCall?> askExportSession(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
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
      : opCall(ExportSessionOp(sessionId: sessionId, format: format));
}

Future<BackendCall?> askChangedFiles(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async => opCall(ChangedFilesOp(sessionId: sessionId));

Future<BackendCall?> askRefreshModels(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async => opCall(const RefreshModelsOp());

/// For a panel that is run by its `flow`, or never run on its own.
Future<BackendCall?> askNothing(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async => null;

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
