import 'dart:async';

import 'package:broski/services/websocket/bridge_transport.dart';
import 'package:broski/services/websocket/inbound_frame_limit.dart';
import 'package:broski/services/websocket_service.dart';
import 'package:flutter_test/flutter_test.dart';

class _NullSink implements BridgeSink {
  final List<String> sent = [];

  @override
  void add(String text, {String? tag}) => sent.add(text);
}

class _Transport implements BridgeTransport {
  final StreamController<dynamic> controller = StreamController<dynamic>();
  final _NullSink writes = _NullSink();

  @override
  Stream<dynamic> get stream => controller.stream;

  @override
  BridgeSink get sink => writes;

  @override
  Future<void> close() async => controller.close();
}

void main() {
  test(
    'a frame over the limit is reported instead of dropped in silence',
    () async {
      final transport = _Transport();
      final socket = WebSocketService();
      final errors = <String>[];
      final messages = <Map<String, dynamic>>[];
      final errorsSub = socket.frameErrors.listen(errors.add);
      final messagesSub = socket.messages.listen(messages.add);

      await socket.connect(transport);
      transport.controller.add('x' * (linkMaxInboundFrameBytes + 1));
      await Future<void>.delayed(Duration.zero);

      expect(errors, hasLength(1));
      expect(errors.single, contains('$linkMaxInboundFrameBytes'));
      expect(messages, isEmpty);

      await errorsSub.cancel();
      await messagesSub.cancel();
      socket.dispose();
    },
  );

  test('a frame at the limit is still decoded', () async {
    final transport = _Transport();
    final socket = WebSocketService();
    final messages = <Map<String, dynamic>>[];
    final messagesSub = socket.messages.listen(messages.add);

    await socket.connect(transport);
    transport.controller.add('{"type":"tick"}');
    await Future<void>.delayed(Duration.zero);

    expect(messages, isEmpty, reason: 'a tick is not forwarded to listeners');

    await messagesSub.cancel();
    socket.dispose();
  });

  test('the limit is the link message cap, not a larger guess', () {
    expect(linkMaxInboundFrameBytes, 8 * 1024 * 1024);
  });
}
