import 'dart:convert';

import 'package:broski/agent/client/contract_frame.dart';
import 'package:broski/agent/client/frame_text.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_test/flutter_test.dart';

import '../support/fixture_json.dart';

/// Reading a frame from its text, and the prefix that tells the app a frame is
/// the contract's before it reads it.
void main() {
  final fixture = objectAt(generatedFixture('frame_prefix.json'), 'fixture');

  group('the prefix', () {
    test('is the one the bridge core writes every frame with', () {
      expect(contractFramePrefix, stringAt(fixture['prefix'], 'prefix'));
      expect(
        stringAt(fixture['example'], 'example'),
        startsWith(contractFramePrefix),
      );
    });

    test('is how the app writes its own frames too, to the character', () {
      final frame = jsonEncode(
        contractFrame(const AbortRequest(requestId: 'r', session: _session)),
      );
      expect(frame, startsWith(contractFramePrefix));
    });

    test('is a frame the core wrote, read from its text', () {
      expect(
        readFrameText(stringAt(fixture['example'], 'example')),
        isA<ContractInbound>().having(
          (frame) => frame.message,
          'message',
          const SessionDetachResponse(requestId: 'r'),
        ),
      );
    });
  });

  group('readFrameText', () {
    InboundFrame read(String text) => readFrameText(text);

    Matcher unreadable(Matcher problem, {String? requestId}) =>
        isA<UnreadableContract>()
            .having((frame) => frame.problem, 'problem', problem)
            .having((frame) => frame.requestId, 'requestId', requestId);

    test('text that is not JSON is unreadable, not thrown', () {
      expect(read('{"type":'), unreadable(contains('not JSON')));
    });

    test('JSON that is not an object is unreadable', () {
      expect(read('[1]'), unreadable(contains('an object')));
    });

    test('a later "type" key wins in JSON, and the frame is not the '
        "contract's after all", () {
      expect(
        read('{"type":"contract","message":{},"type":"batch"}'),
        unreadable(contains('not a contract frame')),
      );
    });

    test(
      'a message that does not decode is unreadable, naming its request',
      () {
        expect(
          read(
            '{"type":"contract","message":'
            '{"type":"session.detach.result","requestId":"asked","extra":1}}',
          ),
          unreadable(contains('extra'), requestId: 'asked'),
        );
      },
    );

    test('an event that does not decode names its session', () {
      final frame = read(
        '{"type":"contract","message":{"type":"event","envelope":'
        '{"session":{"backend":"pi","sessionId":"s1"},"seq":"one"}}}',
      );
      expect(
        frame,
        isA<UnreadableContract>().having(
          (read) => read.session,
          'session',
          const SessionRef(backend: BackendId.pi, sessionId: 's1'),
        ),
      );
    });

    test('a frame with more than its two keys is unreadable', () {
      expect(
        read('{"type":"contract","message":{},"more":1}'),
        unreadable(contains('{"type":"contract"')),
      );
    });
  });
}

const _session = SessionRef(backend: BackendId.pi, sessionId: 's');
