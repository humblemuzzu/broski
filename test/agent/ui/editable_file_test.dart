import 'package:broski/contract/generated/contract.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/op_sheet_rig.dart';
import '../support/widget_rig.dart';

EditableFile _file({
  String id = 'project-settings',
  String text = '{}',
  String revision = 'r1',
  bool exists = true,
  bool editable = true,
  bool truncated = false,
  List<String> problems = const [],
}) => EditableFile(
  id: id,
  path: '/work/.claude/settings.json',
  scope: 'project',
  format: EditableFileFormat.json,
  exists: exists,
  text: text,
  revision: revision,
  editable: editable,
  truncated: truncated,
  problems: problems,
);

ConfigFileEntry _entry(
  String id,
  String label, {
  String group = 'Settings',
  String scope = 'project',
  bool exists = true,
  bool editable = true,
  bool template = false,
}) => ConfigFileEntry(
  id: id,
  label: label,
  group: group,
  scope: scope,
  path: '/work/.claude/$id',
  exists: exists,
  editable: editable,
  format: EditableFileFormat.markdown,
  template: template,
);

final _listing = ConfigFilesListed(
  files: [
    _entry('project-settings', 'Project settings'),
    _entry('user-settings', 'User settings', scope: 'user'),
    _entry('managed', 'Managed policy', scope: 'managed', editable: false),
    _entry('commands', 'Commands', group: 'Commands', template: true),
    _entry('claude-md', 'CLAUDE.md', group: 'Memory', exists: false),
  ],
  omitted: 0,
);

typedef _Handler = BackendCallResponse Function(BackendCallRequest request);

Future<WidgetRig> _openFiles(
  WidgetTester tester, {
  required _Handler onFile,
}) async {
  final rig = await openChat(tester, ['config_files', 'config_file']);
  rig.bridge.on<BackendCallRequest>(
    (request) => switch (request.call) {
      ClaudeCodeCall(op: ConfigFileOp()) => onFile(request),
      _ => answered(request, _listing),
    },
  );
  await openPanel(tester, 'config_files');
  return rig;
}

ConfigFileOp _lastFileOp(WidgetRig rig) => lastOp(rig) as ConfigFileOp;

void main() {
  testWidgets('files are listed by group with their scope and state', (
    tester,
  ) async {
    await _openFiles(
      tester,
      onFile: (r) => answered(r, ConfigFileRead(file: _file())),
    );
    expect(byKey('config-group:Settings'), findsOneWidget);
    expect(byKey('config-group:Commands'), findsOneWidget);
    expect(byKey('config-group:Memory'), findsOneWidget);
    expect(find.text('managed'), findsOneWidget);
    expect(find.text('read-only'), findsOneWidget);
    expect(find.text('not there yet'), findsOneWidget);
    expect(find.text('add new'), findsOneWidget);
  });

  testWidgets('a file opens with a way back to the list, read again', (
    tester,
  ) async {
    final rig = await _openFiles(
      tester,
      onFile: (r) => answered(r, ConfigFileRead(file: _file())),
    );
    await tapKey(tester, 'config-file:project-settings');
    expect(byKey('editable-file-text'), findsOneWidget);
    expect(byKey('config-file:project-settings'), findsNothing);

    await tapKey(tester, 'file-back');
    expect(byKey('config-file:project-settings'), findsOneWidget);
    expect(byKey('editable-file-text'), findsNothing);
    expect(lastOp(rig), const ConfigFilesOp(cwd: '/work'));
  });

  testWidgets('going back with unsaved text asks first', (tester) async {
    final rig = await _openFiles(
      tester,
      onFile: (r) => answered(r, ConfigFileRead(file: _file())),
    );
    await tapKey(tester, 'config-file:project-settings');
    await tester.enterText(byKey('editable-file-text'), '{"a": 1}');
    await tapKey(tester, 'file-back');
    expect(find.text('Discard your edit?'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(byKey('editable-file-text'), findsOneWidget);
    expect(allOps(rig).whereType<ConfigFilesOp>().length, 1);

    await tapKey(tester, 'file-back');
    await tester.tap(find.text('Discard'));
    await tester.pumpAndSettle();
    expect(byKey('config-file:project-settings'), findsOneWidget);
  });

  testWidgets('a save is written at the revision read, and shows the file '
      'the Mac answered with', (tester) async {
    final rig = await _openFiles(
      tester,
      onFile: (r) => switch ((r.call as ClaudeCodeCall).op) {
        ConfigFileOp(change: EditableFileWrite(:final text)) => answered(
          r,
          ConfigFileRead(
            file: _file(text: text, revision: 'r2'),
          ),
        ),
        _ => answered(r, ConfigFileRead(file: _file())),
      },
    );
    await tapKey(tester, 'config-file:project-settings');
    expect(
      tester.widget<FilledButton>(byKey('editable-file-save')).onPressed,
      isNull,
    );

    await tester.enterText(byKey('editable-file-text'), '{"a": 1}');
    await tapKey(tester, 'editable-file-save');
    expect(
      _lastFileOp(rig),
      const ConfigFileOp(
        cwd: '/work',
        fileId: 'project-settings',
        change: EditableFileWrite(text: '{"a": 1}', revision: 'r1'),
      ),
    );
    expect(find.text('Saved.'), findsOneWidget);

    await tester.enterText(byKey('editable-file-text'), '{"a": 2}');
    await tapKey(tester, 'editable-file-save');
    expect(
      (_lastFileOp(rig).change as EditableFileWrite).revision,
      'r2',
      reason: 'the next save is at the revision the Mac answered with',
    );
  });

  testWidgets('a stale save keeps the text, writes nothing over the newer '
      'file, and reload takes the newer one', (tester) async {
    final rig = await _openFiles(
      tester,
      onFile: (r) => switch ((r.call as ClaudeCodeCall).op) {
        ConfigFileOp(change: EditableFileWrite()) => refused(
          r,
          RejectionCode.stale,
          'Another revision is on disk.',
        ),
        _ => answered(
          r,
          ConfigFileRead(
            file: _file(text: '{"newer": true}', revision: 'r9'),
          ),
        ),
      },
    );
    await tapKey(tester, 'config-file:project-settings');
    await tester.enterText(byKey('editable-file-text'), '{"mine": 1}');
    await tapKey(tester, 'editable-file-save');

    expect(byKey('file-refusal:FileStale'), findsOneWidget);
    expect(find.textContaining('Another revision is on disk.'), findsOneWidget);
    expect(find.text('{"mine": 1}'), findsOneWidget);
    final writes = allOps(
      rig,
    ).whereType<ConfigFileOp>().where((op) => op.change != null);
    expect(writes.length, 1, reason: 'no second write on its own');

    await tapKey(tester, 'file-reload');
    expect(_lastFileOp(rig).change, isNull);
    expect(find.text('{"newer": true}'), findsOneWidget);
    expect(byKey('file-refusal:FileStale'), findsNothing);
  });

  testWidgets('an invalid write tells the problem and keeps the text', (
    tester,
  ) async {
    await _openFiles(
      tester,
      onFile: (r) => switch ((r.call as ClaudeCodeCall).op) {
        ConfigFileOp(change: EditableFileWrite()) => refused(
          r,
          RejectionCode.invalidInput,
          'Unexpected token at line 1.',
        ),
        _ => answered(r, ConfigFileRead(file: _file())),
      },
    );
    await tapKey(tester, 'config-file:project-settings');
    await tester.enterText(byKey('editable-file-text'), '{oops');
    await tapKey(tester, 'editable-file-save');
    expect(byKey('file-refusal:FileInvalid'), findsOneWidget);
    expect(find.textContaining('Unexpected token at line 1.'), findsOneWidget);
    expect(find.text('{oops'), findsOneWidget);
    expect(byKey('file-reload'), findsNothing);
  });

  testWidgets('a file the Mac will not change says so', (tester) async {
    await _openFiles(
      tester,
      onFile: (r) => switch ((r.call as ClaudeCodeCall).op) {
        ConfigFileOp(change: EditableFileWrite()) => refused(
          r,
          RejectionCode.unsupported,
          'Set by your organisation.',
        ),
        _ => answered(r, ConfigFileRead(file: _file())),
      },
    );
    await tapKey(tester, 'config-file:project-settings');
    await tester.enterText(byKey('editable-file-text'), '{"a": 1}');
    await tapKey(tester, 'editable-file-save');
    expect(byKey('file-refusal:FileLocked'), findsOneWidget);
    expect(find.textContaining('Set by your organisation.'), findsOneWidget);
  });

  testWidgets('a read-only file offers no save, and a truncated one says '
      'why', (tester) async {
    await _openFiles(
      tester,
      onFile: (r) => answered(
        r,
        ConfigFileRead(
          file: _file(
            id: 'managed',
            editable: false,
            truncated: true,
            text: 'first part',
            problems: ['Skipped: not valid JSON'],
          ),
        ),
      ),
    );
    await tapKey(tester, 'config-file:managed');
    expect(byKey('editable-file-save'), findsNothing);
    expect(byKey('editable-file-delete'), findsNothing);
    expect(byKey('file-truncated'), findsOneWidget);
    expect(find.text('Skipped: not valid JSON'), findsOneWidget);
    expect(
      tester.widget<TextField>(byKey('editable-file-text')).readOnly,
      isTrue,
    );
  });

  testWidgets('a delete is confirmed, sent at the revision, and returns to '
      'the list', (tester) async {
    final rig = await _openFiles(
      tester,
      onFile: (r) => switch ((r.call as ClaudeCodeCall).op) {
        ConfigFileOp(change: EditableFileDelete()) => answered(
          r,
          ConfigFileRead(file: _file(exists: false, text: '')),
        ),
        _ => answered(r, ConfigFileRead(file: _file())),
      },
    );
    await tapKey(tester, 'config-file:project-settings');
    await tapKey(tester, 'editable-file-delete');
    expect(
      find.text(
        'The file is moved to the Trash on the Mac, where it can be restored.',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('cannot be undone'), findsNothing);
    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(
      allOps(rig).whereType<ConfigFileOp>().where((op) => op.change != null),
      isEmpty,
    );

    await tapKey(tester, 'editable-file-delete');
    await tester.tap(find.text('Delete').last);
    await tester.pumpAndSettle();
    expect(
      allOps(rig).whereType<ConfigFileOp>().last,
      const ConfigFileOp(
        cwd: '/work',
        fileId: 'project-settings',
        change: EditableFileDelete(revision: 'r1'),
      ),
    );
    expect(lastOp(rig), const ConfigFilesOp(cwd: '/work'));
    expect(byKey('config-file:project-settings'), findsOneWidget);
  });

  testWidgets('a new command is named, opened from its template and created '
      'at the template revision', (tester) async {
    final rig = await _openFiles(
      tester,
      onFile: (r) => switch ((r.call as ClaudeCodeCall).op) {
        ConfigFileOp(change: EditableFileWrite(:final text)) => answered(
          r,
          ConfigFileRead(
            file: _file(id: 'commands/ship', text: text, revision: 'r2'),
          ),
        ),
        _ => answered(
          r,
          ConfigFileRead(
            file: _file(
              id: 'commands/ship',
              exists: false,
              text: '# Describe it',
              revision: 'new',
            ),
          ),
        ),
      },
    );
    await tapKey(tester, 'config-file:commands');
    await tester.enterText(find.byType(TextField).last, 'ship');
    await tester.tap(find.text('Create'));
    await tester.pumpAndSettle();
    expect(
      _lastFileOp(rig),
      const ConfigFileOp(cwd: '/work', fileId: 'commands', name: 'ship'),
    );
    expect(find.text('new file'), findsOneWidget);

    await tapKey(tester, 'editable-file-save');
    expect(
      _lastFileOp(rig),
      const ConfigFileOp(
        cwd: '/work',
        fileId: 'commands/ship',
        change: EditableFileWrite(text: '# Describe it', revision: 'new'),
      ),
    );
    expect(byKey('editable-file-delete'), findsOneWidget);
  });

  testWidgets('a refusal to open a file is told and the list stays', (
    tester,
  ) async {
    await _openFiles(
      tester,
      onFile: (r) => refused(r, RejectionCode.invalidInput, 'Not a file name.'),
    );
    await tapKey(tester, 'config-file:project-settings');
    expect(find.text('Not a file name.'), findsOneWidget);
    expect(byKey('config-file:project-settings'), findsOneWidget);
  });
}
