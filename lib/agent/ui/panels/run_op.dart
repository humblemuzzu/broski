import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/ui/chat/file_change_view.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';

/// Asks what [panel] needs, calls the backend, and shows what came back. A
/// history-rewriting operation reaches the conversation through the
/// catalog's `transcript_invalidated` (contract §13).
Future<void> runOp(
  BuildContext context,
  ContractClient client,
  OpPanel panel,
  SessionRef session, {
  TranscriptItemId? itemId,
}) async {
  final call = await panel.ask(context, session.sessionId, itemId);
  if (call == null || !context.mounted) return;
  final outcome = await client.callBackend(call);
  if (!context.mounted) return;
  switch (outcome) {
    case Done(value: final result):
      await DetailSheet.show<void>(
        context: context,
        title: panel.label,
        child: Padding(
          padding: Insets.screen,
          child: OpResultView(result: result),
        ),
      );
    case Refused() || Unreached():
      showProblem(context, problemOf(outcome));
  }
}

class OpResultView extends StatelessWidget {
  const OpResultView({super.key, required this.result});

  final BackendOpResult result;

  @override
  Widget build(BuildContext context) => switch (result) {
    RewindFilesResult(
      :final canRewind,
      :final filesChanged,
      :final insertions,
      :final deletions,
      :final skippedLinks,
      :final error,
    ) =>
      Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            canRewind
                ? 'The files can be rewound.'
                : 'The files cannot be rewound.',
          ),
          if (error != null) Text(error),
          if (filesChanged != null)
            for (final path in filesChanged) Text(path),
          if (insertions != null || deletions != null)
            Text('+${insertions ?? 0} −${deletions ?? 0}'),
          if (skippedLinks != null && skippedLinks > 0)
            Text(
              '$skippedLinks files were left alone: a link sat at their path.',
            ),
        ],
      ),
    RevertStaged(:final files) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('Staged. Commit or undo it from the session menu.'),
        for (final change in files) FileChangeView(change: change),
      ],
    ),
    ReviewStarted() => const Text('The review runs in this session.'),
    Reverted() ||
    RevertCommitted() ||
    TreeNavigated() => const Text('Done. The conversation reloads.'),
    TakenOver() => const Text('This session now runs from your phone.'),
    RevertCleared() => const Text('The staged revert was undone.'),
  };
}
