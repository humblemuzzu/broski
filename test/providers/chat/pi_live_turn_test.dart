import 'dart:convert';
import 'dart:io';

import 'package:broski/models/message.dart';
import 'package:broski/providers/chat/chat_run_state.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/services/bridge_service.dart';
import 'package:broski/utils/shell_command_input.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../support/fake_websocket.dart';

/// The frames the bridge sent one phone for a Pi prompt whose model thought, ran two bash commands (a
/// tools extension's bash, which takes `cmd`) and answered. Captured from `pi_live_stream.test.ts`'s rig.
List<Map<String, dynamic>> _capturedTurn() {
  final raw = File(
    'test/support/fixtures/pi_two_bash_turn.json',
  ).readAsStringSync();
  return (jsonDecode(raw) as List<dynamic>).cast<Map<String, dynamic>>();
}

void main() {
  late FakeWebSocket socket;
  late ChatSessionNotifier chat;

  /// Built inside the test body so the notifier's projection timer runs on the test's fake clock.
  void startDraftChat() {
    final fakeSocket = FakeWebSocket();
    final notifier = ChatSessionNotifier(BridgeService(fakeSocket));
    notifier.setPiSession(sessionId: '', cwd: '/work/repo');
    socket = fakeSocket;
    chat = notifier;
    addTearDown(() async {
      notifier.dispose();
      await fakeSocket.close();
    });
  }

  Future<void> deliver(WidgetTester tester, Map<String, dynamic> frame) async {
    socket.deliver(frame);
    await tester.pump(const Duration(milliseconds: 20));
  }

  bool isToolEvent(Map<String, dynamic> frame, String type) =>
      (frame['data'] as Map<String, dynamic>)['type'] == type;

  ChatMessage assistant() =>
      chat.state.messages.lastWhere((m) => m.role == MessageRole.assistant);

  testWidgets('a draft chat shows the commands, their output, the thinking '
      'and the answer, and ends not running', (tester) async {
    startDraftChat();
    for (final frame in _capturedTurn()) {
      await deliver(tester, frame);
    }

    final message = assistant();
    expect(message.text, '6 commits to push.');
    expect(message.reasoningParts.single.text, 'Count the commits.Show them.');
    expect(message.toolCalls.map((tool) => tool.name), ['bash', 'bash']);
    expect(message.toolCalls.map((tool) => shellCommandOf(tool.input)), [
      'echo 6',
      'echo abc123 fix one',
    ]);
    expect(message.toolCalls.map((tool) => tool.status), [
      'completed',
      'completed',
    ]);
    expect(message.toolCalls[0].output, contains('6'));
    expect(message.toolCalls[1].output, contains('abc123 fix one'));
    expect(message.isStreaming, isFalse);
    expect(chatIsRunning(chat.state), isFalse);
  });

  testWidgets('the run is shown as running from the first event until the '
      'agent finishes, however many model round trips it takes', (
    tester,
  ) async {
    startDraftChat();
    final frames = _capturedTurn();
    final running = <bool>[];
    for (final frame in frames) {
      await deliver(tester, frame);
      final data = frame['data'] as Map<String, dynamic>;
      if (frame['type'] == 'runtime_event' &&
          data['type'] != 'agent_finished') {
        running.add(chatIsRunning(chat.state));
      }
    }

    expect(running, everyElement(isTrue));
    expect(frames.where((f) => isToolEvent(f, 'agent_finished')), hasLength(1));
  });

  testWidgets('a command the bridge named cmd is shown on its card while it '
      'is still running', (tester) async {
    startDraftChat();
    final frames = _capturedTurn();
    final firstStart = frames.indexWhere((f) => isToolEvent(f, 'tool_started'));
    for (final frame in frames.take(firstStart + 1)) {
      await deliver(tester, frame);
    }

    final tool = assistant().toolCalls.single;
    expect(tool.status, 'running');
    expect(shellCommandOf(tool.input), 'echo 6');
  });

  testWidgets('Stop ends the run on the phone although nothing came back '
      'from the bridge', (tester) async {
    startDraftChat();
    final frames = _capturedTurn();
    final firstStart = frames.indexWhere((f) => isToolEvent(f, 'tool_started'));
    for (final frame in frames.take(firstStart + 1)) {
      await deliver(tester, frame);
    }
    expect(chatIsRunning(chat.state), isTrue);

    chat.cancelRunLocally();
    await tester.pump(const Duration(milliseconds: 20));

    expect(chatIsRunning(chat.state), isFalse);
    final tool = assistant().toolCalls.single;
    expect(tool.status, 'error');
    expect(tool.output, 'Stopped');
    expect(assistant().isStreaming, isFalse);
  });
}
