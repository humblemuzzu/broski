import 'package:broski/providers/chat_provider.dart';
import 'package:broski/services/bridge_service.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

Map<String, dynamic> rttEvent({
  required int seq,
  int? seqStart,
  String type = 'assistant_text_delta',
}) {
  return {
    'type': 'runtime_event',
    'data': {
      'type': type,
      'backend': 'codex',
      'timestampMs': seq,
      'sessionId': 'cx-1',
      'streamId': 'stream-1',
      'seq': seq,
      if (seqStart != null) 'seqStart': seqStart,
      if (type == 'assistant_text_delta') 'delta': 'x',
    },
  };
}

void main() {
  late FakeWebSocket socket;
  late ChatSessionNotifier chat;

  setUp(() {
    socket = FakeWebSocket();
    chat = ChatSessionNotifier(BridgeService(socket));
    chat.setCodexThread(threadId: 'cx-1', cwd: '/tmp/p');
    socket.sent.clear();
  });

  tearDown(() async {
    chat.dispose();
    await socket.close();
  });

  Future<void> deliver(Map<String, dynamic> message) async {
    socket.deliver(message);
    await pumpEventQueue();
  }

  int recoveries() =>
      socket.sent.where((message) => message['type'] == 'set_view').length;

  test('a coalesced delta span is not a gap', () async {
    await deliver(rttEvent(seq: 1, type: 'agent_started'));
    await deliver(rttEvent(seq: 9, seqStart: 2));
    await deliver(rttEvent(seq: 14, seqStart: 10));

    expect(recoveries(), 0);
  });

  test('an event without seqStart is checked against its own seq', () async {
    await deliver(rttEvent(seq: 1, type: 'agent_started'));
    await deliver(rttEvent(seq: 2));

    expect(recoveries(), 0);
  });

  test('a real gap without seqStart asks the bridge to resend', () async {
    await deliver(rttEvent(seq: 1, type: 'agent_started'));
    await deliver(rttEvent(seq: 5));

    expect(recoveries(), 1);
  });

  test('a real gap asks the bridge to resend', () async {
    await deliver(rttEvent(seq: 1, type: 'agent_started'));
    await deliver(rttEvent(seq: 14, seqStart: 10));
    await deliver(rttEvent(seq: 15));

    expect(recoveries(), 1);
  });
}
