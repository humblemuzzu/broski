import 'dart:async';

import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:broski/agent/ui/panels/transfer/import_upload.dart';
import 'package:broski/contract/generated/contract.dart';
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
  final sending = _Sending();
  final dialog = DialogRoute<void>(
    context: context,
    barrierDismissible: false,
    builder: (_) => _SendingDialog(file: picked, sending: sending),
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
    UploadedSession(:final sessionId) => _Imported(
      session: SessionRef(backend: backend, sessionId: sessionId),
    ),
    UploadRefused(:final reason) => Text(
      'Not imported. $reason',
      key: const ValueKey('import-refused'),
    ),
    UploadStopped() => null,
  };
  if (shown == null) return;
  await DetailSheet.show<void>(
    context: context,
    title: 'Import session',
    child: Padding(padding: Insets.screen, child: shown),
  );
}

/// How far an upload is, and whether the person asked to stop it.
final class _Sending {
  final sent = ValueNotifier<int>(0);
  final stopped = ValueNotifier<bool>(false);

  void dispose() {
    sent.dispose();
    stopped.dispose();
  }
}

class _SendingDialog extends StatelessWidget {
  const _SendingDialog({required this.file, required this.sending});

  final PickedFile file;
  final _Sending sending;

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: false,
    child: AlertDialog(
      title: const Text('Sending to your Mac'),
      content: ValueListenableBuilder<int>(
        valueListenable: sending.sent,
        builder: (context, bytes, _) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(file.name),
            const SizedBox(height: Spacing.sm),
            LinearProgressIndicator(
              key: const ValueKey('import-progress'),
              value: file.size == 0 ? null : bytes / file.size,
            ),
          ],
        ),
      ),
      actions: [
        ValueListenableBuilder<bool>(
          valueListenable: sending.stopped,
          builder: (context, stopped, _) => TextButton(
            key: const ValueKey('import-cancel'),
            onPressed: stopped ? null : () => sending.stopped.value = true,
            child: Text(stopped ? 'Stopping…' : 'Cancel'),
          ),
        ),
      ],
    ),
  );
}

class _Imported extends StatelessWidget {
  const _Imported({required this.session});

  final SessionRef session;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      const Expanded(
        key: ValueKey('import-done'),
        child: Text('Imported. It is in the list.'),
      ),
      TextButton(
        key: const ValueKey('import-open'),
        onPressed: () {
          Navigator.of(context).pop();
          openSession(context, session);
        },
        child: const Text('Open'),
      ),
    ],
  );
}
