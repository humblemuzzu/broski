import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/ui/panels/op_result_host.dart';
import 'package:broski/agent/ui/panels/op_result_view.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// What an operation runs with: the contract client and the phone's files.
typedef OpTools = ({ContractClient client, FileTransfers files});

/// Read while the widget that offers the operation is still there: a sheet
/// that closes before the operation runs takes its `ref` with it.
OpTools opToolsOf(WidgetRef ref) => (
  client: ref.read(contractClientProvider),
  files: ref.read(fileTransfersProvider),
);

/// Asks what [panel] needs, calls the backend, and shows what came back. A
/// history-rewriting operation reaches the conversation through the
/// catalog's `transcript_invalidated` (contract §13).
Future<void> runOp(
  BuildContext context,
  OpTools tools,
  OpPanel panel,
  OpTarget target,
) async {
  final (:client, :files) = tools;
  final flow = panel.flow;
  if (flow != null) return flow(context, client, target.session, files);
  final call = await panel.ask(context, target);
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
          child: OpResultHost(
            client: client,
            target: target,
            first: result,
            builder: (result, actions) => OpResultView(
              result: result,
              actions: actions,
              session: target.session,
            ),
          ),
        ),
      );
    case Refused() || Unreached():
      showProblem(context, problemOf(outcome));
  }
}
