import 'dart:convert';
import 'dart:typed_data';

import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/panels/transfer/file_transfers.dart';
import 'package:broski/agent/ui/sessions/session_list_screen.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/memory_file_transfers.dart';
import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

final _importOffered = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': ['import_session'],
});

/// A file larger than a session file may be, which must not be read.
final class _Oversized implements PickedFile {
  @override
  String get name => 'huge.jsonl';

  @override
  int get size => contractMaxImportBytes + 1;

  @override
  Stream<List<int>> open() => throw StateError('an oversized file is read');
}

Future<(WidgetRig, MemoryFileTransfers)> _list(
  WidgetTester tester, {
  PickedFile? pick,
  Capabilities capabilities = everything,
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final transfers = MemoryFileTransfers(pick: pick);
  final rig = WidgetRig(capabilities: capabilities);
  addTearDown(rig.dispose);
  rig.bridge.on<SessionsListRequest>(
    (request) => SessionsListResponse(
      requestId: request.requestId,
      result: const SessionsListed(page: SessionPage(items: [summary])),
    ),
  );
  await rig.pump(
    tester,
    SessionListScreen(
      backend: BackendDescriptor(
        id: sessionRef.backend,
        capabilities: capabilities,
      ),
    ),
    overrides: [fileTransfersProvider.overrideWithValue(transfers)],
  );
  return (rig, transfers);
}

Finder _key(String key) => find.byKey(ValueKey(key));

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _startImport(WidgetTester tester) async {
  await _tap(tester, _key('backend-panels'));
  await _tap(tester, _key('backend-panel:import_session'));
}

List<ImportSessionOp> _uploads(WidgetRig rig) => [
  for (final request in rig.link.sent.whereType<BackendCallRequest>())
    if (request.call case PiCall(op: final ImportSessionOp op)) op,
];

void _takeEverything(WidgetRig rig) {
  rig.bridge.on<BackendCallRequest>((request) {
    final op = switch (request.call) {
      PiCall(op: final ImportSessionOp op) => op,
      _ => null,
    };
    if (op == null) return null;
    final received = op.offset + base64Decode(op.data).length;
    return BackendCallResponse(
      requestId: request.requestId,
      result: BackendCallAccepted(
        result: SessionImported(
          received: received,
          sessionId: op.last ? 'imported-1' : null,
        ),
      ),
    );
  });
}

void main() {
  testWidgets(
    'a file past the size of a part is sent in order, in parts of the '
    'size the contract bounds, the last one asking for the import',
    (tester) async {
      final contents = Uint8List.fromList(
        List.generate(1200000, (at) => at % 251),
      );
      final (rig, _) = await _list(
        tester,
        pick: MemoryPickedFile('s.jsonl', contents),
        capabilities: _importOffered,
      );
      _takeEverything(rig);

      await _startImport(tester);

      final parts = _uploads(rig);
      expect(parts.map((part) => part.offset), [0, 524288, 1048576]);
      expect(parts.map((part) => part.last), [false, false, true]);
      expect(parts.map((part) => part.uploadId).toSet(), hasLength(1));
      expect(
        parts.map((part) => base64Decode(part.data).length),
        everyElement(lessThanOrEqualTo(contractMaxTransferPartBytes)),
      );
      expect(
        parts.map((part) => part.data.length),
        everyElement(lessThanOrEqualTo(contractMaxTransferPartChars)),
      );
      final sent = BytesBuilder();
      for (final part in parts) {
        sent.add(base64Decode(part.data));
      }
      expect(sent.toBytes(), contents);
      expect(_key('import-done'), findsOneWidget);
      expect(find.text('Imported. It is in the list.'), findsOneWidget);
    },
  );

  testWidgets('a small file is one part that is also the last', (tester) async {
    final (rig, _) = await _list(
      tester,
      pick: MemoryPickedFile(
        's.jsonl',
        Uint8List.fromList(utf8.encode('{}\n')),
      ),
      capabilities: _importOffered,
    );
    _takeEverything(rig);
    await _startImport(tester);
    expect(_uploads(rig).map((part) => (part.offset, part.last)), [(0, true)]);
  });

  testWidgets('the new session can be opened from the answer', (tester) async {
    final (rig, _) = await _list(
      tester,
      pick: MemoryPickedFile(
        's.jsonl',
        Uint8List.fromList(utf8.encode('{}\n')),
      ),
      capabilities: _importOffered,
    );
    _takeEverything(rig);
    await _startImport(tester);
    await _tap(tester, _key('import-open'));
    expect(find.byType(AgentChatScreen), findsOneWidget);
  });

  testWidgets('a file the Mac refuses shows why, and says it is not imported', (
    tester,
  ) async {
    final (rig, _) = await _list(
      tester,
      pick: MemoryPickedFile('s.jsonl', Uint8List.fromList(utf8.encode('x'))),
      capabilities: _importOffered,
    );
    rig.bridge.on<BackendCallRequest>(
      (request) => BackendCallResponse(
        requestId: request.requestId,
        result: const Rejected(
          rejection: Rejection(
            code: RejectionCode.invalidInput,
            message:
                'this is not a Pi session file: line 1 is not a Pi session '
                'header',
          ),
        ),
      ),
    );
    await _startImport(tester);
    expect(
      find.text(
        'Not imported. this is not a Pi session file: line 1 is not a Pi '
        'session header',
      ),
      findsOneWidget,
    );
    expect(_key('import-done'), findsNothing);
  });

  testWidgets('a refusal in the middle of an upload ends it there', (
    tester,
  ) async {
    final (rig, _) = await _list(
      tester,
      pick: MemoryPickedFile('s.jsonl', Uint8List(1200000)),
      capabilities: _importOffered,
    );
    rig.bridge.on<BackendCallRequest>(
      (request) => BackendCallResponse(
        requestId: request.requestId,
        result: const Rejected(
          rejection: Rejection(
            code: RejectionCode.invalidInput,
            message: 'the Mac holds 0 bytes of this upload',
          ),
        ),
      ),
    );
    await _startImport(tester);
    expect(_uploads(rig), hasLength(1));
    expect(
      find.text('Not imported. the Mac holds 0 bytes of this upload'),
      findsOneWidget,
    );
  });

  testWidgets('a file larger than a session file may be is not read or sent', (
    tester,
  ) async {
    final (rig, _) = await _list(
      tester,
      pick: _Oversized(),
      capabilities: _importOffered,
    );
    await _startImport(tester);
    expect(_uploads(rig), isEmpty);
    expect(
      find.textContaining('A session file may be at most 256 MB'),
      findsOne,
    );
  });

  testWidgets('choosing nothing sends nothing', (tester) async {
    final (rig, _) = await _list(tester, capabilities: _importOffered);
    await _startImport(tester);
    expect(_uploads(rig), isEmpty);
    expect(_key('import-done'), findsNothing);
  });

  testWidgets('a backend that cannot import offers no way to', (tester) async {
    await _list(tester);
    expect(_key('backend-panels'), findsNothing);
  });
}
