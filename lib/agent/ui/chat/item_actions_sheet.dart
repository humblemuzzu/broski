import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/chat/copy_text.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/panels/run_op.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What can be done with one row of the conversation: copy its [text], and,
/// from a finished item of the history, fork the session there (contract
/// §11.1, `ForkPoint`) and run the backend's item operations. Those need
/// [itemId], which only a finished item has, because its id is the
/// transcript's.
void showItemActions(
  BuildContext context,
  SessionRef session, {
  TranscriptItemId? itemId,
  String? text,
  Capabilities? capabilities,
}) {
  final fromHere = itemId != null && capabilities != null;
  final panels = fromHere ? panelsAt(capabilities, OpPlace.item) : const [];
  final canFork = fromHere && capabilities.fork;
  if (!canFork && panels.isEmpty && text == null) return;
  DetailSheet.show<void>(
    context: context,
    title: fromHere ? 'From here' : 'Message',
    child: Consumer(
      builder: (sheetContext, ref, _) {
        // Runs from `context`, the screen under the sheet, once it closed.
        void run(Future<void> Function(OpTools tools) action) {
          final tools = opToolsOf(ref);
          Navigator.of(sheetContext).pop();
          action(tools);
        }

        return Column(
          children: [
            if (text != null)
              _action('item-copy', 'Copy text', () {
                Navigator.of(sheetContext).pop();
                copyToClipboard(context, text);
              }),
            if (canFork)
              for (final position in ForkPosition.values)
                _action(
                  'fork:${position.wire}',
                  position == ForkPosition.before
                      ? 'Fork just before this'
                      : 'Fork through this',
                  () => run(
                    (tools) =>
                        _fork(context, tools.client, session, itemId, position),
                  ),
                ),
            for (final panel in panels)
              _action(
                'item-panel:${panel.kind.wire}',
                panel.label,
                () => run(
                  (tools) => runOp(context, tools, panel, (
                    session: session,
                    cwd: null,
                    itemId: itemId,
                  )),
                ),
              ),
          ],
        );
      },
    ),
  );
}

/// Whether a finished item has anything to do beyond copying its text.
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
