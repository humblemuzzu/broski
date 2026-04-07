import 'package:broski/models/vcs.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('VcsInfo', () {
    test('fromJson parses branch and default_branch', () {
      final json = {'branch': 'feature/auth', 'default_branch': 'main'};
      final vcs = VcsInfo.fromJson(json);
      expect(vcs.branch, 'feature/auth');
      expect(vcs.defaultBranch, 'main');
    });

    test('fromJson handles missing fields', () {
      final vcs = VcsInfo.fromJson({});
      expect(vcs.branch, isNull);
      expect(vcs.defaultBranch, isNull);
      expect(vcs.isAvailable, isFalse);
      expect(vcs.isOnFeatureBranch, isFalse);
    });

    test('fromJson handles branch only (no default_branch)', () {
      final vcs = VcsInfo.fromJson({'branch': 'main'});
      expect(vcs.branch, 'main');
      expect(vcs.defaultBranch, isNull);
      expect(vcs.isAvailable, isTrue);
      expect(vcs.isOnFeatureBranch, isFalse);
    });

    test('isAvailable is true when branch is non-empty', () {
      expect(const VcsInfo(branch: 'main').isAvailable, isTrue);
      expect(const VcsInfo(branch: '').isAvailable, isFalse);
      expect(const VcsInfo().isAvailable, isFalse);
    });

    test('isOnFeatureBranch is true when branch differs from default', () {
      const onFeature = VcsInfo(branch: 'feature/x', defaultBranch: 'main');
      expect(onFeature.isOnFeatureBranch, isTrue);

      const onMain = VcsInfo(branch: 'main', defaultBranch: 'main');
      expect(onMain.isOnFeatureBranch, isFalse);

      const noDefault = VcsInfo(branch: 'feature/x');
      expect(noDefault.isOnFeatureBranch, isFalse);

      const noBranch = VcsInfo(defaultBranch: 'main');
      expect(noBranch.isOnFeatureBranch, isFalse);
    });

    test('toJson round-trips correctly', () {
      const original = VcsInfo(branch: 'dev', defaultBranch: 'main');
      final json = original.toJson();
      expect(json['branch'], 'dev');
      expect(json['default_branch'], 'main');

      final restored = VcsInfo.fromJson(json);
      expect(restored, original);
    });

    test('toJson omits null fields', () {
      const vcs = VcsInfo(branch: 'main');
      final json = vcs.toJson();
      expect(json.containsKey('branch'), isTrue);
      expect(json.containsKey('default_branch'), isFalse);
    });

    test('copyWith updates selected fields', () {
      const original = VcsInfo(branch: 'main', defaultBranch: 'main');
      final updated = original.copyWith(branch: 'feature/new');
      expect(updated.branch, 'feature/new');
      expect(updated.defaultBranch, 'main');
    });

    test('equality and hashCode', () {
      const a = VcsInfo(branch: 'main', defaultBranch: 'main');
      const b = VcsInfo(branch: 'main', defaultBranch: 'main');
      const c = VcsInfo(branch: 'dev', defaultBranch: 'main');

      expect(a, equals(b));
      expect(a.hashCode, equals(b.hashCode));
      expect(a, isNot(equals(c)));
    });
  });

  group('VcsDiffFile', () {
    test('fromJson parses all fields', () {
      final json = {
        'file': 'src/auth/login.ts',
        'before': 'old content',
        'after': 'new content',
        'additions': 15,
        'deletions': 3,
        'status': 'modified',
      };
      final diff = VcsDiffFile.fromJson(json);
      expect(diff.file, 'src/auth/login.ts');
      expect(diff.before, 'old content');
      expect(diff.after, 'new content');
      expect(diff.additions, 15);
      expect(diff.deletions, 3);
      expect(diff.status, 'modified');
    });

    test('fromJson handles missing fields with defaults', () {
      final diff = VcsDiffFile.fromJson({});
      expect(diff.file, '');
      expect(diff.before, '');
      expect(diff.after, '');
      expect(diff.additions, 0);
      expect(diff.deletions, 0);
      expect(diff.status, isNull);
    });

    test('filename extracts just the filename', () {
      const diff = VcsDiffFile(file: 'src/auth/login.ts');
      expect(diff.filename, 'login.ts');

      const root = VcsDiffFile(file: 'README.md');
      expect(root.filename, 'README.md');
    });

    test('statusLabel returns correct labels', () {
      expect(const VcsDiffFile(file: 'a', status: 'added').statusLabel, 'A');
      expect(const VcsDiffFile(file: 'a', status: 'deleted').statusLabel, 'D');
      expect(const VcsDiffFile(file: 'a', status: 'modified').statusLabel, 'M');
      expect(const VcsDiffFile(file: 'a', status: 'unknown').statusLabel, '?');
      expect(const VcsDiffFile(file: 'a').statusLabel, '?');
    });

    test('status convenience getters', () {
      const added = VcsDiffFile(file: 'a', status: 'added');
      expect(added.isAdded, isTrue);
      expect(added.isDeleted, isFalse);
      expect(added.isModified, isFalse);

      const deleted = VcsDiffFile(file: 'b', status: 'deleted');
      expect(deleted.isDeleted, isTrue);

      const modified = VcsDiffFile(file: 'c', status: 'modified');
      expect(modified.isModified, isTrue);
    });

    test('equality compares file and status', () {
      const a = VcsDiffFile(file: 'x.ts', status: 'modified');
      const b = VcsDiffFile(file: 'x.ts', status: 'modified');
      const c = VcsDiffFile(file: 'x.ts', status: 'added');
      const d = VcsDiffFile(file: 'y.ts', status: 'modified');

      expect(a, equals(b));
      expect(a.hashCode, equals(b.hashCode));
      expect(a, isNot(equals(c)));
      expect(a, isNot(equals(d)));
    });

    test('toString is useful for debugging', () {
      const diff = VcsDiffFile(
        file: 'src/main.ts',
        additions: 10,
        deletions: 5,
        status: 'modified',
      );
      expect(diff.toString(), 'VcsDiffFile(M src/main.ts +10 -5)');
    });
  });
}
