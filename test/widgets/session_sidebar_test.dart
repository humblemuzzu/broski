import 'package:broski/models/claude_code.dart';
import 'package:broski/models/message.dart';
import 'package:broski/models/session_context.dart';
import 'package:broski/models/todo.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/themes/all_themes.dart';
import 'package:broski/widgets/session_sidebar.dart';
import 'package:broski/widgets/sidebar/shared_session_sidebar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import '../link/ui/link_ui_support.dart';

const _context = SessionContext(
  tokens: TokenUsage(
    input: 1200,
    output: 400,
    total: 1600,
    contextTokens: 1200,
    contextWindow: 200000,
  ),
  cost: 0.42,
  lsp: [],
  modifiedFiles: [
    ModifiedFile(
      file: 'lib/widgets/session_sidebar.dart',
      additions: 4,
      deletions: 1,
    ),
  ],
);

const _todos = [
  Todo(
    id: 't1',
    content: 'Split the sidebar',
    status: TodoStatus.completed,
    priority: TodoPriority.medium,
  ),
  Todo(
    id: 't2',
    content: 'Keep the look',
    status: TodoStatus.inProgress,
    priority: TodoPriority.high,
  ),
];

const _diffs = [
  DiffEntry(
    file: 'lib/widgets/sidebar/sidebar_section.dart',
    before: '',
    after: '',
    additions: 7,
    deletions: 2,
  ),
];

const _init = CCSessionInit(
  sessionId: 's1',
  model: 'sonnet',
  permissionMode: ClaudeCodePermissionMode.defaultMode,
  tools: ['Read', 'Edit'],
  slashCommands: [],
  skills: ['deploy', 'review'],
  mcpServers: [
    {'name': 'github', 'status': 'connected'},
  ],
  plugins: [],
  supportedModels: [],
  claudeCodeVersion: '2.0.0',
);

Future<void> _pump(WidgetTester tester, Widget sidebar) async {
  tester.view.physicalSize = const Size(900, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: linkUiContainer(),
      child: MaterialApp(
        theme: ThemeData.dark().copyWith(extensions: const [opencodeDarkTheme]),
        home: Scaffold(body: sidebar),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets('the Claude Code sidebar keeps the shared sections and adds its '
      'own', (tester) async {
    await _pump(
      tester,
      const SessionSidebar(
        sessionTitle: 'Fix the build',
        sessionContext: _context,
        todos: _todos,
        sessionDiffs: _diffs,
        ccInit: _init,
      ),
    );

    expect(find.text('Fix the build'), findsOneWidget);
    expect(find.text('Context'), findsOneWidget);
    expect(find.text("What's using context?"), findsOneWidget);
    expect(find.text('Claude Code'), findsOneWidget);
    expect(find.text('MCP Servers'), findsNWidgets(2));
    expect(find.text('github'), findsOneWidget);
    expect(find.text('Skills'), findsOneWidget);
    expect(find.text('deploy'), findsOneWidget);
    expect(find.text('Plan'), findsOneWidget);
    expect(find.text('1/2 done'), findsOneWidget);
    expect(find.text('Split the sidebar'), findsOneWidget);
    expect(find.text('Changes'), findsOneWidget);
    expect(find.text('Modified Files'), findsOneWidget);
  });

  testWidgets('an unstarted Claude Code session says it is waiting', (
    tester,
  ) async {
    await _pump(
      tester,
      const SessionSidebar(sessionTitle: '', sessionContext: _context),
    );

    expect(find.text('Session Details'), findsOneWidget);
    expect(find.text('Session Info'), findsOneWidget);
    expect(find.text('Waiting for session...'), findsOneWidget);
    expect(find.text("What's using context?"), findsNothing);
    expect(find.text('Skills'), findsNothing);
    expect(find.text('No active plan'), findsOneWidget);
    expect(find.text('No diffs yet'), findsOneWidget);
  });

  testWidgets('the shared sidebar draws the rows the caller names and no '
      'Claude Code section', (tester) async {
    await _pump(
      tester,
      const SharedSessionSidebar(
        sessionTitle: 'Pi session',
        sessionContext: _context,
        todos: _todos,
        sessionDiffs: _diffs,
        infoRows: [
          (icon: AppIcons.memory, label: 'Model', value: 'pi-1'),
          (icon: AppIcons.folder, label: 'Directory', value: '/work/app'),
        ],
      ),
    );

    expect(find.text('Pi session'), findsOneWidget);
    expect(find.text('Context'), findsOneWidget);
    expect(find.text('Session Info'), findsOneWidget);
    expect(find.text('Model'), findsOneWidget);
    expect(find.text('pi-1'), findsOneWidget);
    expect(find.text('/work/app'), findsOneWidget);
    expect(find.text('Plan'), findsOneWidget);
    expect(find.text('Changes'), findsOneWidget);
    expect(find.text('Modified Files'), findsOneWidget);
    expect(find.text("What's using context?"), findsNothing);
    expect(find.text('Claude Code'), findsNothing);
    expect(find.text('Skills'), findsNothing);
  });
}
