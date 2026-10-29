/// What each backend operation asks the person before it is called. The
/// call's type is the contract's own: each operation belongs to one backend's
/// union (contract §13), and only that backend lists it in `backendOps`.
library;

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

Future<BackendCall?> askReviewStart(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async {
  final kind = await _choose(
    context,
    title: 'Review what?',
    body: 'The review runs as a run of this session.',
    options: const {
      'Uncommitted changes': _Review.uncommitted,
      'Against a base branch': _Review.baseBranch,
      'One commit': _Review.commit,
      'Custom instructions': _Review.custom,
    },
  );
  if (kind == null || !context.mounted) return null;
  final target = await _reviewTarget(context, kind);
  if (target == null) return null;
  return CodexCall(
    op: ReviewStartOp(sessionId: sessionId, target: target),
  );
}

enum _Review { uncommitted, baseBranch, commit, custom }

Future<ReviewTarget?> _reviewTarget(BuildContext context, _Review kind) async {
  final (title, build) = switch (kind) {
    _Review.uncommitted => ('', null),
    _Review.baseBranch => (
      'Base branch',
      (String text) => BaseBranchReview(branch: text),
    ),
    _Review.commit => ('Commit SHA', (String text) => CommitReview(sha: text)),
    _Review.custom => (
      'Instructions',
      (String text) => CustomReview(instructions: text),
    ),
  };
  if (build == null) return const UncommittedReview();
  final text = await askForText(context, title: title, action: 'Review');
  return text == null ? null : build(text);
}

Future<BackendCall?> askRevert(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? itemId,
) async {
  if (itemId == null) return null;
  final sure = await askToConfirm(
    context,
    title: 'Revert history from here?',
    body:
        'This turn and every later one leave the history. Files are untouched.',
    action: 'Revert',
  );
  return sure
      ? CodexCall(
          op: RevertOp(sessionId: sessionId, beforeItemId: itemId),
        )
      : null;
}

Future<BackendCall?> askRevertStage(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? itemId,
) async {
  if (itemId == null) return null;
  final restoreFiles = await _choose(
    context,
    title: 'Stage a revert to before this?',
    body: 'Nothing leaves the history until the revert is committed.',
    options: const {'Restore the files too': true, 'Keep the files': false},
  );
  if (restoreFiles == null) return null;
  return OpenCodeCall(
    op: RevertStageOp(
      sessionId: sessionId,
      itemId: itemId,
      restoreFiles: restoreFiles,
    ),
  );
}

Future<BackendCall?> askRevertClear(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async => OpenCodeCall(op: RevertClearOp(sessionId: sessionId));

Future<BackendCall?> askRevertCommit(
  BuildContext context,
  SessionId sessionId,
  TranscriptItemId? _,
) async {
  final sure = await askToConfirm(
    context,
    title: 'Commit the staged revert?',
    body: 'The history past the revert point is deleted.',
    action: 'Commit',
  );
  return sure ? OpenCodeCall(op: RevertCommitOp(sessionId: sessionId)) : null;
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
  return PiCall(
    op: NavigateTreeOp(
      sessionId: sessionId,
      itemId: itemId,
      summarize: summarize,
    ),
  );
}

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
