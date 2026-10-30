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
/// open it, or the reason it did not.
Future<void> runImport(
  BuildContext context,
  ContractClient client,
  FileTransfers files,
  BackendId backend,
) async {
  final picked = await files.pickFile();
  if (picked == null || !context.mounted) return;
  final sent = ValueNotifier<int>(0);
  unawaited(
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (_) => _SendingDialog(file: picked, sent: sent),
    ),
  );
  final end = await uploadSessionFile(
    client: client,
    file: picked,
    onProgress: (bytes) => sent.value = bytes,
  );
  sent.dispose();
  if (!context.mounted) return;
  Navigator.of(context, rootNavigator: true).pop();
  await DetailSheet.show<void>(
    context: context,
    title: 'Import session',
    child: Padding(
      padding: Insets.screen,
      child: switch (end) {
        UploadedSession(:final sessionId) => _Imported(
          session: SessionRef(backend: backend, sessionId: sessionId),
        ),
        UploadRefused(:final reason) => Text(
          'Not imported. $reason',
          key: const ValueKey('import-refused'),
        ),
      },
    ),
  );
}

class _SendingDialog extends StatelessWidget {
  const _SendingDialog({required this.file, required this.sent});

  final PickedFile file;
  final ValueNotifier<int> sent;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Sending to your Mac'),
    content: ValueListenableBuilder<int>(
      valueListenable: sent,
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
