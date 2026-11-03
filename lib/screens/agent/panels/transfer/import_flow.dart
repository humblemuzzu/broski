import 'dart:async';

import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/transfer/file_transfers.dart';
import 'package:broski/screens/agent/panels/transfer/import_result.dart';
import 'package:broski/screens/agent/panels/transfer/import_sending.dart';
import 'package:broski/screens/agent/panels/transfer/import_upload.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';

/// Chooses a session file on the phone, sends it to the Mac showing how far
/// it is, and says whether the Mac took it: the new session, with a way to
/// open it, or the reason it did not. The progress stays up until the upload
/// ends, whatever is pressed, and Cancel stops it after the part under way.
Future<void> runImport(
  BuildContext context,
  ContractClient client,
  FileTransfers files,
  BackendId backend,
) async {
  final picked = await files.pickFile();
  if (picked == null || !context.mounted) return;
  final navigator = Navigator.of(context, rootNavigator: true);
  final sending = ImportSending();
  final dialog = DialogRoute<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => ImportSendingDialog(file: picked, sending: sending),
  );
  unawaited(navigator.push(dialog));
  final end = await uploadSessionFile(
    client: client,
    backend: backend,
    file: picked,
    onProgress: (bytes) => sending.sent.value = bytes,
    stopped: () => sending.stopped.value,
  );
  if (dialog.isActive) navigator.removeRoute(dialog);
  sending.dispose();
  if (!context.mounted) return;
  final shown = switch (end) {
    UploadedSession(:final sessionId) => ImportedSession(
      session: SessionRef(backend: backend, sessionId: sessionId),
    ),
    UploadRefused(:final reason) => ImportRefusedView(reason: reason),
    UploadStopped() => null,
  };
  if (shown == null) return;
  await DetailSheet.show<void>(
    context: context,
    title: 'Import session',
    child: Padding(padding: Insets.screen, child: shown),
  );
}
