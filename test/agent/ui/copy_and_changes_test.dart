import 'package:broski/agent/ui/chat/agent_chat_screen.dart';
import 'package:broski/agent/ui/chat/file_change_view.dart';
import 'package:broski/agent/ui/panels/transfer/changed_files_view.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/theme.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/session_fixtures.dart';
import '../support/widget_rig.dart';

const _question = UserMessageItem(
  id: 'u1',
  text: 'How do I read a file?',
  attachments: [],
);
const _answer = BlockItem(
  id: 'b1',
  messageId: 'm1',
  block: BlockKind.text,
  text: 'Use File.readAsString.',
);
const _thinking = BlockItem(
  id: 'b0',
  messageId: 'm1',
  block: BlockKind.thinking,
  text: 'Considering the options',
);
const _followUp = UserMessageItem(
  id: 'u2',
  text: 'And a directory?',
  attachments: [],
);
const _secondAnswer = BlockItem(
  id: 'b2',
  messageId: 'm2',
  block: BlockKind.text,
  text: 'Use Directory.list.',
);

final _changesOffered = Capabilities.fromJson({
  ...everything.toJson(),
  'backendOps': ['changed_files'],
});

final List<String> _clipboard = [];

Future<WidgetRig> _chat(
  WidgetTester tester, {
  List<TranscriptItem> newestFirst = const [],
  Capabilities capabilities = nothing,
}) async {
  tester.view.physicalSize = const Size(1200, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  _clipboard.clear();
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
    SystemChannels.platform,
    (call) async {
      if (call.method == 'Clipboard.setData') {
        final data = call.arguments as Map<Object?, Object?>;
        _clipboard.add(data['text']! as String);
      }
      return null;
    },
  );
  addTearDown(
    () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      null,
    ),
  );
  final rig = WidgetRig(capabilities: capabilities);
  addTearDown(rig.dispose);
  rig.bridge.on<TranscriptReadRequest>(
    (request) => pageAnswer(request, newestFirst),
  );
  await rig.pump(tester, const AgentChatScreen(session: sessionRef));
  return rig;
}

Finder _key(String key) => find.byKey(ValueKey(key));

void main() {
  group('copying the last answer', () {
    testWidgets('puts the newest text the session wrote on the clipboard', (
      tester,
    ) async {
      await _chat(
        tester,
        newestFirst: [_secondAnswer, _followUp, _answer, _thinking, _question],
      );
      await tester.tap(_key('chat-copy-last'));
      await tester.pump();
      expect(_clipboard, ['Use Directory.list.']);
      expect(find.text('Copied'), findsOneWidget);
    });

    testWidgets('is not the thinking, nor what the person wrote', (
      tester,
    ) async {
      await _chat(tester, newestFirst: [_followUp, _thinking, _question]);
      expect(_key('chat-copy-last'), findsNothing);
    });

    testWidgets('is not offered while the session has said nothing', (
      tester,
    ) async {
      await _chat(tester);
      expect(_key('chat-copy-last'), findsNothing);
    });
  });

  group('copying a message', () {
    /// Text under a finger selects words instead of opening the actions, so
    /// the actions are opened as a screen reader opens them.
    Future<void> openActions(WidgetTester tester, String text) async {
      final actions = find.ancestor(
        of: find.textContaining(text),
        matching: find.byWidgetPredicate(
          (widget) =>
              widget is Semantics &&
              (widget.properties.customSemanticsActions?.keys.any(
                    (action) => action.label == 'Actions from here',
                  ) ??
                  false),
        ),
      );
      tester
          .widget<Semantics>(actions.first)
          .properties
          .customSemanticsActions
          ?.values
          .single();
      await tester.pumpAndSettle();
    }

    testWidgets('what the person wrote, from its actions', (tester) async {
      await _chat(tester, newestFirst: [_answer, _question]);
      await openActions(tester, 'How do I read a file?');
      await tester.tap(_key('item-copy'));
      await tester.pumpAndSettle();
      expect(_clipboard, ['How do I read a file?']);
    });

    testWidgets('what the session wrote, with no fork offered where the '
        'backend has none', (tester) async {
      await _chat(tester, newestFirst: [_answer, _question]);
      await openActions(tester, 'Use File.readAsString.');
      expect(_key('item-copy'), findsOneWidget);
      expect(find.textContaining('Fork'), findsNothing);
      await tester.tap(_key('item-copy'));
      await tester.pumpAndSettle();
      expect(_clipboard, ['Use File.readAsString.']);
    });

    testWidgets('beside the fork the backend offers', (tester) async {
      await _chat(
        tester,
        newestFirst: [_answer, _question],
        capabilities: everything,
      );
      await openActions(tester, 'Use File.readAsString.');
      expect(_key('item-copy'), findsOneWidget);
      expect(_key('fork:through'), findsOneWidget);
    });
  });

  group('the files a session changed', () {
    ChangedFilesListed changes({int omitted = 0}) => ChangedFilesListed(
      files: const [
        FileChange(
          path: 'lib/a.dart',
          change: FileChangeKind.modified,
          additions: 12,
          deletions: 3,
        ),
        FileChange(
          path: 'lib/new.dart',
          change: FileChangeKind.modified,
          additions: 40,
        ),
      ],
      omitted: omitted,
      additions: 52,
      deletions: 3,
    );

    testWidgets('are opened from the session menu, each with its counts and '
        'the totals', (tester) async {
      final rig = await _chat(tester, capabilities: _changesOffered);
      rig.bridge.on<BackendCallRequest>(
        (request) => BackendCallResponse(
          requestId: request.requestId,
          result: BackendCallAccepted(result: changes()),
        ),
      );
      await tester.tap(_key('chat-panels'));
      await tester.pumpAndSettle();
      await tester.tap(_key('panel:changed_files'));
      await tester.pumpAndSettle();

      expect(
        rig.sent<BackendCallRequest>().call,
        const PiCall(op: ChangedFilesOp(sessionId: 's1')),
      );
      expect(find.text('2 files changed'), findsOneWidget);
      expect(_countsOf(tester, 'changed-file:lib/a.dart'), '+12 −3');
      expect(_countsOf(tester, 'changed-file:lib/new.dart'), '+40');
      expect(_countsOf(tester, 'changed-files-total'), '+52 −3');
    });

    testWidgets('are drawn one way wherever a change without a diff is shown', (
      tester,
    ) async {
      const change = FileChange(
        path: 'lib/b.dart',
        change: FileChangeKind.modified,
        additions: 4,
        deletions: 1,
      );
      await _view(tester, const FileChangeView(change: change));
      expect(find.text('modified lib/b.dart'), findsOneWidget);
      expect(tester.widget<FileCounts>(find.byType(FileCounts)).additions, 4);
      await _view(
        tester,
        const ChangedFilesView(
          changed: ChangedFilesListed(
            files: [change],
            omitted: 0,
            additions: 4,
            deletions: 1,
          ),
        ),
      );
      expect(find.byType(FileChangeLine), findsOneWidget);
      expect(find.text('modified lib/b.dart'), findsOneWidget);
    });

    testWidgets('say how many more there are past the list', (tester) async {
      await _view(tester, ChangedFilesView(changed: changes(omitted: 7)));
      expect(find.text('9 files changed'), findsOneWidget);
      expect(find.text('and 7 more'), findsOneWidget);
    });

    testWidgets('are none for a session that changed nothing', (tester) async {
      await _view(
        tester,
        const ChangedFilesView(
          changed: ChangedFilesListed(
            files: [],
            omitted: 0,
            additions: 0,
            deletions: 0,
          ),
        ),
      );
      expect(find.text('No file was changed in this session.'), findsOne);
    });
  });
}

String _countsOf(WidgetTester tester, String key) {
  final scope = find.descendant(
    of: find.byKey(ValueKey(key)),
    matching: find.byType(RichText),
  );
  final counts = tester.widgetList<RichText>(scope).last;
  return counts.text.toPlainText();
}

Future<void> _view(WidgetTester tester, Widget child) => tester.pumpWidget(
  MaterialApp(
    theme: BroskiTheme.fromOpenCodeTheme(opencodeDarkTheme),
    home: Scaffold(body: child),
  ),
);
