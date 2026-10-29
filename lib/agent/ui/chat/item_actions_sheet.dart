import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/panels/run_op.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What can be done from one finished item of the history: fork the session
/// there (contract §11.1, `ForkPoint`) and the backend's item operations.
/// Only finished items are offered, because their ids are the transcript's.
void showItemActions(
  BuildContext context,
  SessionRef session, {
  required TranscriptItemId itemId,
  required Capabilities capabilities,
}) {
  final panels = panelsAt(capabilities, OpPlace.item);
  if (!hasItemActions(capabilities)) return;
  DetailSheet.show<void>(
    context: context,
    title: 'From here',
    child: Consumer(
      builder: (sheetContext, ref, _) {
        // Runs from `context`, the screen under the sheet, once it closed.
        void run(Future<void> Function(ContractClient client) action) {
          final client = ref.read(contractClientProvider);
          Navigator.of(sheetContext).pop();
          action(client);
        }

        return Column(
          children: [
            if (capabilities.fork)
              for (final position in ForkPosition.values)
                _action(
                  'fork:${position.wire}',
                  position == ForkPosition.before
                      ? 'Fork just before this'
                      : 'Fork through this',
                  () => run(
                    (client) =>
                        _fork(context, client, session, itemId, position),
                  ),
                ),
            for (final panel in panels)
              _action(
                'item-panel:${panel.kind.wire}',
                panel.label,
                () => run(
                  (client) =>
                      runOp(context, client, panel, session, itemId: itemId),
                ),
              ),
          ],
        );
      },
    ),
  );
}

bool hasItemActions(Capabilities capabilities) =>
    capabilities.fork || panelsAt(capabilities, OpPlace.item).isNotEmpty;

Widget _action(String key, String label, VoidCallback onTap) =>
    ListTile(key: ValueKey(key), title: Text(label), onTap: onTap);

Future<void> _fork(
  BuildContext context,
  ContractClient client,
  SessionRef session,
  TranscriptItemId itemId,
  ForkPosition position,
) async {
  final outcome = await client.forkSession(
    session,
    at: ForkPoint(itemId: itemId, position: position),
  );
  if (!context.mounted) return;
  if (outcome case Done(value: final forked)) {
    await openSession(context, forked);
  } else {
    showProblem(context, problemOf(outcome));
  }
}
