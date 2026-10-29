import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/panels/run_op.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The session-wide operations the backend declares. The chosen one runs
/// from [context], the screen under the sheet, once the sheet has closed.
void showPanels(
  BuildContext context,
  SessionRef session,
  Capabilities capabilities,
) => DetailSheet.show<void>(
  context: context,
  title: 'More',
  child: Consumer(
    builder: (sheetContext, ref, _) => Column(
      children: [
        for (final panel in panelsAt(capabilities, OpPlace.session))
          ListTile(
            key: ValueKey('panel:${panel.kind.wire}'),
            title: Text(panel.label),
            onTap: () {
              final client = ref.read(contractClientProvider);
              Navigator.of(sheetContext).pop();
              runOp(context, client, panel, session);
            },
          ),
      ],
    ),
  ),
);
