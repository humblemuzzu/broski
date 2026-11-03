import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/agent/chat/copy_text.dart';
import 'package:broski/screens/agent/panels/panel_registry.dart';
import 'package:broski/screens/agent/panels/run_op.dart';
import 'package:broski/screens/agent/shared/sheet_action_tile.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What can be done with one row of the conversation: copy its [text], and,
/// from a finished item of the history, fork the session there (contract
/// §11.1, `ForkPoint`) and run the backend's item operations. Those need
/// [itemId], which only a finished item has, because its id is the
/// transcript's. A row of several items forks "just before this" before its
/// first, [beforeItemId], and "through this" through its last, [itemId].
void showItemActions(
  BuildContext context,
  SessionRef session, {
  TranscriptItemId? itemId,
  TranscriptItemId? beforeItemId,
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
    initialSize: 0.35,
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
              SheetActionTile(
                key: const ValueKey('item-copy'),
                icon: AppIcons.copy,
                label: 'Copy text',
                detail: 'Put this message on the clipboard',
                onTap: () {
                  Navigator.of(sheetContext).pop();
                  copyToClipboard(context, text);
                },
              ),
            if (canFork)
              for (final position in ForkPosition.values)
                SheetActionTile(
                  key: ValueKey('fork:${position.wire}'),
                  icon: AppIcons.callSplit,
                  label: position == ForkPosition.before
                      ? 'Fork just before this'
                      : 'Fork through this',
                  detail: 'A new session branch from this point',
                  onTap: () => run(
                    (tools) => _fork(
                      context,
                      tools.client,
                      session,
                      position == ForkPosition.before
                          ? beforeItemId ?? itemId
                          : itemId,
                      position,
                    ),
                  ),
                ),
            for (final panel in panels)
              SheetActionTile(
                key: ValueKey('item-panel:${panel.kind.wire}'),
                icon: AppIcons.history,
                label: panel.label,
                onTap: () => run(
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
