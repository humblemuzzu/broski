import 'dart:convert';
import 'dart:typed_data';

import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:broski/contract/generated/contract.dart';

/// Reads an export part by part into [file], in order, and checks what
/// arrived: every part where it was asked for, valid base64, and in all the
/// size the Mac said. Null when the whole file is in [file]; otherwise what
/// went wrong, for a person to read. [onProgress] is told the bytes held;
/// the download stops, with no problem to show, once [stopped] says so.
Future<String?> downloadExport({
  required ContractClient client,
  required DownloadedFile file,
  required SessionRef session,
  required SessionExported exported,
  required void Function(int received) onProgress,
  required bool Function() stopped,
}) async {
  var offset = 0;
  while (!stopped()) {
    final outcome = await client.callBackend(
      opCall(
        session,
        ExportPartOp(
          sessionId: session.sessionId,
          exportId: exported.exportId,
          offset: offset,
        ),
      ),
    );
    final piece = switch (outcome) {
      Done(value: final ExportPartRead read) => read,
      _ => null,
    };
    if (piece == null) {
      return problemOf(outcome) ?? 'The Mac answered something else.';
    }
    if (piece.offset != offset) return 'A part came from the wrong place.';
    final bytes = _decode(piece.data);
    if (bytes == null) return 'A part of the file was damaged on the way.';
    await file.add(bytes);
    offset += bytes.length;
    onProgress(offset);
    if (piece.done) {
      return offset == exported.bytes
          ? null
          : 'Received $offset of ${exported.bytes} bytes.';
    }
    if (bytes.isEmpty) return 'The Mac sent an empty part before the end.';
  }
  return null;
}

Uint8List? _decode(String data) {
  try {
    return base64Decode(data);
  } on FormatException {
    return null;
  }
}
