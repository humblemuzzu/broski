import 'dart:convert';
import 'dart:isolate';

import 'package:broski/agent/client/contract_frame.dart';
import 'package:broski/agent/client/frame_lane.dart';
import 'package:broski/agent/client/frame_text.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

/// Reads nothing: it says which isolate it ran on, so a test can see where a
/// frame was read.
InboundFrame _whereRead(String text) =>
    UnreadableContract(problem: '${Isolate.current.debugName}');

InboundFrame _breaks(String text) => throw StateError('the reader broke');

/// A detach answer for request [id], padded to about [chars] characters with
/// a string in a field the contract allows to be long.
String _frame(String id, {int chars = 0}) {
  final padding = chars == 0
      ? <String, Object?>{}
      : {
          'result': {
            'status': 'accepted',
            'page': {
              'items': [
                {
                  'kind': 'block',
                  'id': 'b',
                  'at': 1,
                  'messageId': 'm',
                  'block': 'text',
                  'text': 'x' * chars,
                },
              ],
              'idStability': 'stable',
            },
          },
        };
  return jsonEncode({
    'type': contractFrameType,
    'message': {
      'type': chars == 0 ? 'session.detach.result' : 'transcript.read.result',
      'requestId': id,
      ...padding,
    },
  });
}

String? _answered(InboundFrame frame) => switch (frame) {
  ContractInbound(message: SessionDetachResponse(:final requestId)) ||
  ContractInbound(
    message: TranscriptReadResponse(:final requestId),
  ) => requestId,
  UnreadableContract(:final requestId) => requestId,
  ContractInbound() => null,
};

/// The lane: frames in the order they arrived, large ones read off the UI
/// isolate, nothing thrown at the caller.
void main() {
  final here = Isolate.current.debugName;
  late List<InboundFrame> delivered;

  setUp(() => delivered = []);

  FrameLane lane({
    FrameReader read = _whereRead,
    int offloadAbove = frameOffloadChars,
  }) =>
      FrameLane(deliver: delivered.add, read: read, offloadAbove: offloadAbove);

  List<String?> readWhere() => [
    for (final frame in delivered)
      if (frame case UnreadableContract(:final problem)) problem,
  ];

  group('where a frame is read', () {
    test('up to the threshold on the UI isolate, at once', () {
      final small = lane();
      small.add('x' * frameOffloadChars);
      expect(readWhere(), [here], reason: 'delivered before add returned');
    });

    test('past the threshold on another isolate', () async {
      final big = lane();
      big.add('x' * (frameOffloadChars + 1));
      expect(delivered, isEmpty, reason: 'not on this isolate, not at once');
      await pumpEventQueue();
      await _until(() => delivered.isNotEmpty);
      expect(readWhere(), [isNot(here)]);
    });

    test('no frame past the threshold is read on the UI isolate, however it '
        'is sized', () async {
      final sizes = [
        frameOffloadChars + 1,
        frameOffloadChars * 2,
        1 << 20,
        8 * (1 << 20),
      ];
      final reading = lane();
      for (final size in sizes) {
        reading.add('x' * size);
      }
      await _until(() => delivered.length == sizes.length);
      expect(readWhere(), everyElement(isNot(here)));
    });

    test('every frame at or under the threshold is read on the UI isolate', () {
      final reading = lane();
      for (final size in [
        0,
        1,
        4096,
        frameOffloadChars - 1,
        frameOffloadChars,
      ]) {
        reading.add('x' * size);
      }
      expect(readWhere(), everyElement(here));
      expect(delivered, hasLength(5));
    });

    test('the threshold is the lane\'s own, and can be set', () {
      lane(offloadAbove: 3).add('abc');
      expect(readWhere(), [here]);
    });
  });

  group('in the order they arrived', () {
    test('a small frame behind a large one waits for it', () async {
      final reading = lane(read: readFrameText);
      reading.add(_frame('big', chars: 4 * frameOffloadChars));
      reading.add(_frame('small'));
      expect(delivered, isEmpty);
      await _until(() => delivered.length == 2);
      expect(delivered.map(_answered), ['big', 'small']);
    });

    test('mixed sizes, many times over, come out as they went in', () async {
      final sent = <String>[];
      final reading = lane(read: readFrameText);
      for (var round = 0; round < 6; round++) {
        for (final (index, chars) in [
          0,
          3 * frameOffloadChars,
          0,
          0,
          40 * frameOffloadChars,
          0,
          frameOffloadChars + 7,
        ].indexed) {
          final id = 'r$round-$index';
          sent.add(id);
          reading.add(_frame(id, chars: chars));
        }
      }
      await _until(() => delivered.length == sent.length);
      expect(delivered.map(_answered), sent);
    });

    test(
      'a frame that arrives while the lane is draining queues behind it',
      () async {
        final reading = lane(read: readFrameText);
        reading.add(_frame('first', chars: 2 * frameOffloadChars));
        await pumpEventQueue();
        reading.add(_frame('second'));
        await _until(() => delivered.length == 2);
        expect(delivered.map(_answered), ['first', 'second']);
      },
    );
  });

  group('what cannot be read', () {
    test(
      'a large frame that is not JSON is unreadable, and the lane goes on',
      () async {
        final reading = lane(read: readFrameText);
        reading.add(
          '{"type":"contract","message":${'x' * 2 * frameOffloadChars}',
        );
        reading.add(_frame('after'));
        await _until(() => delivered.length == 2);
        expect(
          delivered.first,
          isA<UnreadableContract>().having(
            (frame) => frame.problem,
            'problem',
            contains('not JSON'),
          ),
        );
        expect(_answered(delivered.last), 'after');
      },
    );

    test(
      'a large frame whose message does not decode names its request',
      () async {
        final reading = lane(read: readFrameText);
        final long = 'y' * 2 * frameOffloadChars;
        reading.add(
          jsonEncode({
            'type': contractFrameType,
            'message': {
              'type': 'transcript.read.result',
              'requestId': 'asked',
              'long': long,
            },
          }),
        );
        await _until(() => delivered.isNotEmpty);
        expect(
          delivered.single,
          isA<UnreadableContract>().having(
            (frame) => frame.requestId,
            'requestId',
            'asked',
          ),
        );
      },
    );

    final broke = isA<UnreadableContract>().having(
      (frame) => frame.problem,
      'problem',
      allOf(contains('could not read'), contains('the reader broke')),
    );

    test('an isolate that fails is a typed failure, not a throw', () async {
      final reading = lane(read: _breaks);
      reading.add('x' * (frameOffloadChars + 1));
      await _until(() => delivered.length == 1);
      expect(delivered.single, broke);
    });

    test('a reader that fails on the UI isolate is a typed failure too, and '
        'the frames behind it are read', () async {
      final reading = lane(read: _breaks);
      reading.add('small');
      expect(delivered, [broke]);
      reading.add('x' * (frameOffloadChars + 1));
      reading.add('small');
      await _until(() => delivered.length == 3);
      expect(delivered, everyElement(broke));
    });
  });

  group('closing', () {
    test('drops what waits and delivers nothing more', () async {
      final reading = lane(read: readFrameText);
      reading.add(_frame('big', chars: 4 * frameOffloadChars));
      reading.add(_frame('small'));
      reading.close();
      reading.add(_frame('late'));
      await pumpEventQueue(times: 50);
      await Future<void>.delayed(const Duration(milliseconds: 200));
      expect(delivered, isEmpty);
    });
  });
}

Future<void> _until(bool Function() done) async {
  final deadline = DateTime.now().add(const Duration(seconds: 20));
  while (!done()) {
    if (DateTime.now().isAfter(deadline)) fail('the lane never delivered');
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}
