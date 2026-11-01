import 'package:broski/models/message.dart';
import 'package:broski/models/session_context.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('ModifiedFile', () {
    test('fromJson parses bridge response correctly', () {
      final file = ModifiedFile.fromJson({
        'file': 'lib/main.dart',
        'additions': 15,
        'deletions': 3,
      });
      expect(file.file, 'lib/main.dart');
      expect(file.additions, 15);
      expect(file.deletions, 3);
      expect(file.hasChanges, true);
    });

    test('fromJson handles missing fields with defaults', () {
      final file = ModifiedFile.fromJson({});
      expect(file.file, '');
      expect(file.additions, 0);
      expect(file.deletions, 0);
      expect(file.hasChanges, false);
    });

    test('fileName extracts just the filename', () {
      final file = ModifiedFile.fromJson({
        'file': 'packages/bridge/src/server.ts',
        'additions': 1,
        'deletions': 0,
      });
      expect(file.fileName, 'server.ts');
    });

    test('shortPath returns last 3 components', () {
      final file = ModifiedFile.fromJson({
        'file': 'packages/bridge/src/handlers/session-stats.ts',
        'additions': 1,
        'deletions': 0,
      });
      expect(file.shortPath, 'src/handlers/session-stats.ts');
    });

    test('formattedAdditions and formattedDeletions', () {
      final file = ModifiedFile.fromJson({
        'file': 'a.dart',
        'additions': 42,
        'deletions': 7,
      });
      expect(file.formattedAdditions, '+42');
      expect(file.formattedDeletions, '-7');
    });
  });

  group('SessionContext factories accept modifiedFiles', () {
    test('fromClaudeCode passes modifiedFiles through', () {
      final files = [
        const ModifiedFile(file: 'a.dart', additions: 5, deletions: 2),
        const ModifiedFile(file: 'b.dart', additions: 3, deletions: 0),
      ];
      final ctx = SessionContext.fromClaudeCode(modifiedFiles: files);
      expect(ctx.modifiedFiles.length, 2);
      expect(ctx.modifiedFiles[0].file, 'a.dart');
      expect(ctx.modifiedFiles[1].file, 'b.dart');
    });

    test('fromJson parses modifiedFiles from bridge response', () {
      final ctx = SessionContext.fromJson({
        'tokens': {
          'input': 100,
          'output': 50,
          'total': 150,
          'contextWindow': 200000,
        },
        'cost': 0.05,
        'lsp': [],
        'modifiedFiles': [
          {'file': 'lib/main.dart', 'additions': 20, 'deletions': 5},
          {'file': 'lib/utils.dart', 'additions': 3, 'deletions': 0},
        ],
      });
      expect(ctx.modifiedFiles.length, 2);
      expect(ctx.modifiedFiles[0].file, 'lib/main.dart');
      expect(ctx.modifiedFiles[0].additions, 20);
      expect(ctx.modifiedFiles[0].deletions, 5);
      expect(ctx.modifiedFiles[1].file, 'lib/utils.dart');
    });

    test('fromJson handles missing modifiedFiles', () {
      final ctx = SessionContext.fromJson({
        'tokens': {'contextWindow': 200000},
        'cost': 0.0,
        'lsp': [],
      });
      expect(ctx.modifiedFiles, isEmpty);
    });
  });

  group('DiffEntry for sessionDiffs accumulation', () {
    test('can be constructed from CC filediff metadata shape', () {
      // This is the shape _accumulateCcSessionDiff receives
      const entry = DiffEntry(
        file: 'lib/widget.dart',
        before: 'old content',
        after: 'new content',
        additions: 5,
        deletions: 2,
        diff:
            '--- a/lib/widget.dart\n+++ b/lib/widget.dart\n@@ -1 +1 @@\n-old\n+new',
        partId: 'tool-use-123',
      );
      expect(entry.file, 'lib/widget.dart');
      expect(entry.additions, 5);
      expect(entry.deletions, 2);
      expect(entry.diff, isNotNull);
      expect(entry.partId, 'tool-use-123');
    });

    test('merge logic: accumulating same file sums additions/deletions', () {
      // Simulate what _accumulateCcSessionDiff does
      final diffs = <DiffEntry>[
        const DiffEntry(
          file: 'app.dart',
          before: '',
          after: '',
          additions: 5,
          deletions: 2,
        ),
      ];

      // Second edit to same file
      const newEntry = DiffEntry(
        file: 'app.dart',
        before: '',
        after: '',
        additions: 3,
        deletions: 1,
      );

      final idx = diffs.indexWhere((d) => d.file == newEntry.file);
      if (idx >= 0) {
        final old = diffs[idx];
        diffs[idx] = DiffEntry(
          file: old.file,
          before: old.before,
          after: newEntry.after,
          additions: old.additions + newEntry.additions,
          deletions: old.deletions + newEntry.deletions,
        );
      } else {
        diffs.add(newEntry);
      }

      expect(diffs.length, 1);
      expect(diffs[0].additions, 8); // 5 + 3
      expect(diffs[0].deletions, 3); // 2 + 1
    });

    test('merge logic: different files stay separate', () {
      final diffs = <DiffEntry>[
        const DiffEntry(
          file: 'a.dart',
          before: '',
          after: '',
          additions: 2,
          deletions: 0,
        ),
      ];

      const newEntry = DiffEntry(
        file: 'b.dart',
        before: '',
        after: '',
        additions: 1,
        deletions: 1,
      );

      final idx = diffs.indexWhere((d) => d.file == newEntry.file);
      if (idx >= 0) {
        final old = diffs[idx];
        diffs[idx] = DiffEntry(
          file: old.file,
          before: old.before,
          after: newEntry.after,
          additions: old.additions + newEntry.additions,
          deletions: old.deletions + newEntry.deletions,
        );
      } else {
        diffs.add(newEntry);
      }

      expect(diffs.length, 2);
      expect(diffs[0].file, 'a.dart');
      expect(diffs[1].file, 'b.dart');
    });
  });
}
