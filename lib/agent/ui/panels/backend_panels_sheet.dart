import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/ui/panels/panel_registry.dart';
import 'package:broski/agent/ui/panels/run_op.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The operations of a backend as a whole, the ones that name no session
/// (contract §13). The chosen one runs from [context], the screen under the
/// sheet, once the sheet has closed.
void showBackendPanels(BuildContext context, BackendDescriptor backend) =>
    DetailSheet.show<void>(
      context: context,
      title: 'More',
      child: Consumer(
        builder: (sheetContext, ref, _) => Column(
          children: [
            for (final panel in panelsAt(backend.capabilities, OpPlace.backend))
              ListTile(
                key: ValueKey('backend-panel:${panel.kind.wire}'),
                title: Text(panel.label),
                onTap: () {
                  final client = ref.read(contractClientProvider);
                  Navigator.of(sheetContext).pop();
                  runOp(
                    context,
                    client,
                    panel,
                    SessionRef(backend: backend.id, sessionId: ''),
                  );
                },
              ),
          ],
        ),
      ),
    );

/// Whether [backend] has any such operation.
bool hasBackendPanels(BackendDescriptor backend) =>
    panelsAt(backend.capabilities, OpPlace.backend).isNotEmpty;
