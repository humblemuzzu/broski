import 'dart:convert';
import 'dart:typed_data';

import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:uuid/uuid.dart';

/// How an upload ended: the new session, or why the Mac did not take the file.
sealed class UploadEnd {
  const UploadEnd();
}

final class UploadedSession extends UploadEnd {
  const UploadedSession(this.sessionId);

  final SessionId sessionId;
}

final class UploadRefused extends UploadEnd {
  const UploadRefused(this.reason);

  final String reason;
}

/// The person stopped it; the Mac lets the parts it holds go when they lie
/// idle.
final class UploadStopped extends UploadEnd {
  const UploadStopped();
}

/// Sends [file] to the Mac in parts of at most `contractMaxTransferPartBytes`,
/// in order, the last one asking the Mac to judge the whole file. The file is
/// read as a stream and never held whole. [onProgress] is told the bytes sent;
/// no part is sent once [stopped] says so.
Future<UploadEnd> uploadSessionFile({
  required ContractClient client,
  required PickedFile file,
  required void Function(int sent) onProgress,
  required bool Function() stopped,
  String? uploadId,
}) async {
  if (file.size > contractMaxImportBytes) {
    return UploadRefused(
      'A session file may be at most '
      '${contractMaxImportBytes ~/ (1024 * 1024)} MB; this one is '
      '${(file.size / (1024 * 1024)).toStringAsFixed(1)} MB.',
    );
  }
  final id = uploadId ?? const Uuid().v4();
  var sent = 0;
  var pending = BytesBuilder(copy: false);
  Future<UploadEnd?> send(Uint8List bytes, {required bool last}) async {
    if (stopped()) return const UploadStopped();
    final outcome = await client.callBackend(
      PiCall(
        op: ImportSessionOp(
          uploadId: id,
          offset: sent,
          data: base64Encode(bytes),
          last: last,
        ),
      ),
    );
    sent += bytes.length;
    onProgress(sent);
    return switch (outcome) {
      Done(value: SessionImported(sessionId: final String session)) =>
        UploadedSession(session),
      Done(value: SessionImported()) when !last => null,
      Done() => const UploadRefused('The Mac answered something else.'),
      _ => UploadRefused(problemOf(outcome) ?? 'The upload failed.'),
    };
  }

  await for (final chunk in file.open()) {
    pending.add(chunk);
    while (pending.length >= contractMaxTransferPartBytes) {
      final all = pending.takeBytes();
      final end = await send(
        Uint8List.sublistView(all, 0, contractMaxTransferPartBytes),
        last: false,
      );
      if (end != null) return end;
      pending = BytesBuilder(copy: false)
        ..add(Uint8List.sublistView(all, contractMaxTransferPartBytes));
    }
  }
  return await send(pending.takeBytes(), last: true) ??
      const UploadRefused('The Mac did not say where the session went.');
}
