import 'dart:convert';
import 'dart:typed_data';

import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/memory_file_transfers.dart';
import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

final _exportOffered = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': ['export_session', 'export_part'],
});

final _page = Uint8List.fromList(utf8.encode('<html>the whole page</html>'));
const _pieces = 5;

Future<(WidgetRig, MemoryFileTransfers)> _chat(
  WidgetTester tester, {
  Capabilities capabilities = everything,
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final transfers = MemoryFileTransfers();
  final rig = WidgetRig(capabilities: capabilities);
  addTearDown(rig.dispose);
  await rig.pump(
    tester,
    const AgentChatScreen(session: sessionRef),
    overrides: [fileTransfersProvider.overrideWithValue(transfers)],
  );
  return (rig, transfers);
}

BackendCallResponse _exported(
  BackendCallRequest request, {
  required int bytes,
  String mimeType = 'text/html',
}) => BackendCallResponse(
  requestId: request.requestId,
  result: BackendCallAccepted(
    result: SessionExported(
      exportId: 'x1',
      name: 'session.html',
      mimeType: mimeType,
      bytes: bytes,
    ),
  ),
);

BackendCallResponse _piece(
  BackendCallRequest request,
  Uint8List file,
  ExportPartOp op, {
  String? data,
}) {
  final end = (op.offset + _pieces).clamp(0, file.length);
  return BackendCallResponse(
    requestId: request.requestId,
    result: BackendCallAccepted(
      result: ExportPartRead(
        offset: op.offset,
        data: data ?? base64Encode(file.sublist(op.offset, end)),
        done: end >= file.length,
      ),
    ),
  );
}

void _serve(WidgetRig rig, Uint8List file, {int? announced}) {
  rig.bridge.on<BackendCallRequest>(
    (request) => switch (request.call) {
      PiCall(op: ExportSessionOp()) => _exported(
        request,
        bytes: announced ?? file.length,
      ),
      PiCall(op: final ExportPartOp op) => _piece(request, file, op),
      _ => null,
    },
  );
}

Finder _key(String key) => find.byKey(ValueKey(key));

/// Taps and lets the sheet or dialog it opens finish sliding in.
Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _startExport(WidgetTester tester, String choice) async {
  await _tap(tester, _key('chat-panels'));
  await _tap(tester, _key('panel:export_session'));
  await _tap(tester, find.text(choice));
}

void main() {
  testWidgets('an export is fetched part by part and handed to the share sheet '
      'whole, with its type', (tester) async {
    final (rig, transfers) = await _chat(tester, capabilities: _exportOffered);
    _serve(rig, _page);

    await _startExport(tester, 'A web page (HTML)');

    final calls = rig.link.sent.whereType<BackendCallRequest>().map(
      (request) => request.call,
    );
    expect(
      calls.first,
      const PiCall(
        op: ExportSessionOp(sessionId: 's1', format: SessionExportFormat.html),
      ),
    );
    final offsets = [
      for (final call in calls.skip(1))
        if (call case PiCall(op: ExportPartOp(:final offset))) offset,
    ];
    expect(offsets, [for (var at = 0; at < _page.length; at += _pieces) at]);
    final download = transfers.downloads.single;
    expect(download.name, 'session.html');
    expect(utf8.decode(download.bytes), '<html>the whole page</html>');
    expect(download.sharedAs, ['text/html']);
    expect(find.text('Ready. Choose where to send it.'), findsOneWidget);
  });

  testWidgets('the file format asked for is the one the person chose', (
    tester,
  ) async {
    final (rig, _) = await _chat(tester, capabilities: _exportOffered);
    _serve(rig, _page);
    await _startExport(tester, 'The session file (JSONL)');
    expect(
      rig.link.sent.whereType<BackendCallRequest>().first.call,
      const PiCall(
        op: ExportSessionOp(sessionId: 's1', format: SessionExportFormat.jsonl),
      ),
    );
  });

  testWidgets('a person can share the same file again', (tester) async {
    final (rig, transfers) = await _chat(tester, capabilities: _exportOffered);
    _serve(rig, _page);
    await _startExport(tester, 'A web page (HTML)');
    await _tap(tester, _key('export-share-again'));
    expect(transfers.downloads.single.sharedAs, ['text/html', 'text/html']);
  });

  testWidgets('a part damaged on the way is said so, nothing is shared and the '
      'partial file is discarded', (tester) async {
    final (rig, transfers) = await _chat(tester, capabilities: _exportOffered);
    rig.bridge.on<BackendCallRequest>(
      (request) => switch (request.call) {
        PiCall(op: ExportSessionOp()) => _exported(request, bytes: 27),
        PiCall(op: final ExportPartOp op) => _piece(
          request,
          _page,
          op,
          data: 'not base64!',
        ),
        _ => null,
      },
    );
    await _startExport(tester, 'A web page (HTML)');
    expect(find.text('A part of the file was damaged on the way.'), findsOne);
    expect(transfers.downloads.single.sharedAs, isEmpty);
    expect(transfers.downloads.single.discarded, isTrue);
    expect(_key('export-retry'), findsOneWidget);
  });

  testWidgets('an export the Mac no longer holds says why', (tester) async {
    final (rig, transfers) = await _chat(tester, capabilities: _exportOffered);
    rig.bridge.on<BackendCallRequest>(
      (request) => switch (request.call) {
        PiCall(op: ExportSessionOp()) => _exported(request, bytes: 27),
        PiCall(op: ExportPartOp()) => BackendCallResponse(
          requestId: request.requestId,
          result: const Rejected(
            rejection: Rejection(
              code: RejectionCode.notFound,
              message: 'this export is gone. Export the session again.',
            ),
          ),
        ),
        _ => null,
      },
    );
    await _startExport(tester, 'A web page (HTML)');
    expect(
      find.text('this export is gone. Export the session again.'),
      findsOneWidget,
    );
    expect(transfers.downloads.single.sharedAs, isEmpty);
  });

  testWidgets('a file shorter than the Mac said is not shared', (tester) async {
    final (rig, transfers) = await _chat(tester, capabilities: _exportOffered);
    _serve(rig, _page, announced: _page.length + 10);
    await _startExport(tester, 'A web page (HTML)');
    expect(
      find.text('Received ${_page.length} of ${_page.length + 10} bytes.'),
      findsOneWidget,
    );
    expect(transfers.downloads.single.sharedAs, isEmpty);
  });

  testWidgets('cancelling the question sends nothing', (tester) async {
    final (rig, _) = await _chat(tester, capabilities: _exportOffered);
    await _tap(tester, _key('chat-panels'));
    await _tap(tester, _key('panel:export_session'));
    await tester.tapAt(const Offset(5, 5));
    await WidgetRig.settle(tester);
    expect(rig.link.sent.whereType<BackendCallRequest>(), isEmpty);
  });

  testWidgets('a backend without export offers none', (tester) async {
    await _chat(tester);
    expect(_key('panel:export_session'), findsNothing);
  });
}
