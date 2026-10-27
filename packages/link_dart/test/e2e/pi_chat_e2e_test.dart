@Tags(['e2e'])
library;

import 'dart:async';
import 'dart:io';

import 'package:test/test.dart';

import 'bridge_session.dart';
import 'pi_chat_fixture.dart';
import 'pi_turn_recorder.dart';
import 'real_machine.dart';
import 'scripted_openai.dart';

const Timeout _budget = Timeout(Duration(seconds: 300));
const Duration _abortBudget = Duration(seconds: 2);

/// A real phone, daemon and bridge, and a real Pi AgentSession answering from a
/// scripted model: what the phone has while the turn runs is the contract.
void main() {
  late ScriptedOpenAi model;
  late Machine machine;
  late PiChatFixture fixture;
  late PiTurnRecorder recorder;

  Future<void> startChat(List<ScriptedTurn> turns) async {
    model = await ScriptedOpenAi.start(turns);
    addTearDown(model.close);
    machine = await startMachine(
      prepare: (sandbox) async {
        fixture = await PiChatFixture.create(sandbox, model);
      },
    );
    await machine.phone.awaitBridgeStatus(
      (status) => status.state.name == 'up',
    );
    recorder = PiTurnRecorder(machine.phone);
    addTearDown(recorder.dispose);
    final session = machine.session;
    final registered = await session.request(
      registerDevice(
        session.key(),
        deviceId: machine.deviceId,
        deviceName: 'e2e phone',
        platform: 'ios',
      ),
    );
    expect(registered['type'], 'device_registered');
    final created = await session.request(
      piNewSession(
        session.key(),
        projectPath: fixture.cwd,
        provider: ScriptedOpenAi.provider,
        modelId: ScriptedOpenAi.modelId,
      ),
    );
    expect(created['type'], 'pi_session_created');
  }

  Future<void> prompt(String text) async {
    final session = machine.session;
    final started = await session.request(
      piChat(session.key(), projectPath: fixture.cwd, prompt: text),
    );
    expect(started['type'], 'pi_chat_started');
  }

  test('the phone has the tools, the output and the thinking while the model '
      'is still working, and the answer when it is done', () async {
    final answerGate = Completer<void>();
    await startChat([
      const ScriptedTurn(
        thinking: ['Count the ', 'commits.'],
        toolCalls: [
          ScriptedToolCall('bash', {
            'command': 'echo first-output',
            'timeout': 15,
          }),
        ],
      ),
      const ScriptedTurn(
        thinking: ['Show them.'],
        toolCalls: [
          ScriptedToolCall('bash', {
            'command': 'echo second-output',
            'timeout': 15,
          }),
        ],
      ),
      ScriptedTurn(
        text: const ['Nothing ', 'to push.'],
        gate: answerGate.future,
      ),
    ]);

    await prompt('bro how many commits we do have to push?');
    final finishedSecond = await recorder.next(
      'tool_finished',
      where: (event) => '${event['output']}'.contains('second-output'),
    );

    expect(finishedSecond['toolName'], 'bash');
    final started = recorder.ofType('tool_started').toList();
    expect(
      [for (final e in started) (e['input']! as Map)['command']],
      ['echo first-output', 'echo second-output'],
    );
    expect(recorder.ofType('tool_updated'), isNotEmpty);
    expect(
      recorder.joined('assistant_thinking_delta'),
      'Count the commits.Show them.',
    );
    expect(
      recorder.ofType('assistant_text_delta'),
      isEmpty,
      reason: 'the answer is still held back by the model',
    );
    expect(recorder.ofType('agent_finished'), isEmpty);

    answerGate.complete();
    await recorder.next('agent_finished');

    expect(recorder.joined('assistant_text_delta'), 'Nothing to push.');
    expect(recorder.ofType('agent_started'), hasLength(1));
    expect(recorder.ofType('agent_finished'), hasLength(1));
    expectCleanReplies(machine.session);
  }, timeout: _budget);

  test('pi_abort ends the turn within two seconds and kills the running '
      'command', () async {
    await startChat([
      const ScriptedTurn(
        toolCalls: [
          ScriptedToolCall('bash', {
            'command': r'echo pid=$$; sleep 60',
            'timeout': 120,
          }),
        ],
      ),
    ]);

    await prompt('run the long thing');
    final output = await recorder.next(
      'tool_updated',
      where: (event) => '${event['partialOutput']}'.contains('pid='),
    );
    final pid = int.parse(
      RegExp(r'pid=(\d+)').firstMatch('${output['partialOutput']}')![1]!,
    );
    expect(_isAlive(pid), isTrue);

    final abortedAt = recorder.events.length;
    final watch = Stopwatch()..start();
    final aborted = await machine.session.request(
      piAbort(machine.session.key(), projectPath: fixture.cwd),
    );
    await recorder.next('agent_finished');
    watch.stop();

    expect(aborted['type'], 'pi_aborted');
    expect(recorder.events.length, greaterThan(abortedAt));
    expect(watch.elapsed, lessThan(_abortBudget));
    await _waitUntilGone(pid);
    expect(_isAlive(pid), isFalse);
  }, timeout: _budget);
}

bool _isAlive(int pid) => Process.killPid(pid, ProcessSignal.sigcont);

/// A killed process is gone a moment later; the OS offers no event to wait on.
Future<void> _waitUntilGone(int pid) async {
  final deadline = DateTime.now().add(_abortBudget);
  while (_isAlive(pid) && DateTime.now().isBefore(deadline)) {
    await Future<void>.delayed(const Duration(milliseconds: 25));
  }
}
