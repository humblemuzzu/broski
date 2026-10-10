import 'package:broski/models/transcript_page.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('TranscriptPage.fromResponse', () {
    test('reads hasMore and the cursor of a paged reply', () {
      final page = TranscriptPage.fromResponse<int>(
        {'hasMore': true, 'nextCursor': '42'},
        [1, 2, 3],
      );

      expect(page.items, [1, 2, 3]);
      expect(page.hasMore, isTrue);
      expect(page.nextCursor, '42');
      expect(page.hasOlder, isTrue);
    });

    test('treats a reply without hasMore as the whole transcript', () {
      final page = TranscriptPage.fromResponse<int>(
        {'requestId': 'r1'},
        [1, 2],
      );

      expect(page.hasMore, isFalse);
      expect(page.nextCursor, isNull);
      expect(page.hasOlder, isFalse);
    });

    test('ignores hasMore without a cursor, so paging cannot loop', () {
      final page = TranscriptPage.fromResponse<int>(
        {'hasMore': true, 'nextCursor': ''},
        [1],
      );

      expect(page.hasMore, isTrue);
      expect(page.nextCursor, isNull);
      expect(page.hasOlder, isFalse);
    });
  });

  group('prependUnique', () {
    String key(int value) => '$value';

    test('keeps the older page in front of the loaded window', () {
      expect(prependUnique([1, 2], [3, 4], key), [1, 2, 3, 4]);
    });

    test('drops entries the window already shows', () {
      expect(prependUnique([1, 2, 3], [3, 4], key), [1, 2, 3, 4]);
      expect(prependUnique([3, 4], [3, 4], key), [3, 4]);
    });

    test('keeps duplicates inside the older page once', () {
      expect(prependUnique([1, 1, 2], [3], key), [1, 2, 3]);
    });

    test('returns the window untouched when nothing is prepended', () {
      final window = [3, 4];
      expect(prependUnique(<int>[], window, key), same(window));
      expect(prependUnique([3], window, key), same(window));
    });
  });

  group('preservedScrollOffset', () {
    test('moves down by the height the older page added', () {
      expect(
        preservedScrollOffset(
          currentOffset: 40,
          maxExtentBefore: 1000,
          maxExtentAfter: 1400,
        ),
        440,
      );
    });

    test('stays put when the viewport did not grow', () {
      expect(
        preservedScrollOffset(
          currentOffset: 700,
          maxExtentBefore: 1000,
          maxExtentAfter: 1000,
        ),
        700,
      );
      expect(
        preservedScrollOffset(
          currentOffset: 700,
          maxExtentBefore: 1000,
          maxExtentAfter: 900,
        ),
        700,
      );
    });
  });
}
