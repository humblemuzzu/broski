@Tags(['e2e'])
library;

import 'dart:io';

import 'package:broski/agent/client/contract_state.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/catalog_requests.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/prompt_desk.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';

import '../../link/e2e/link_daemon.dart';
import 'e2e_phone.dart';
import 'fake_bridge_process.dart';

const _budget = Timeout(Duration(seconds: 300));

/// A machine: the real broski-link daemon and the real bridge with the fake
/// backend in its core, and a project directory in a throwaway temp tree.
final class _Machine {
  _Machine(this.daemon, this.bridge, this.cwd);

  final LinkDaemon daemon;
  final FakeBridgeProcess bridge;
  final String cwd;

  static Future<_Machine> start() async {
    final daemon = await LinkDaemon.start();
    final bridge = await FakeBridgeProcess.start(
      socket: daemon.bridgeSocket,
      keyFile: '${daemon.home}/bridge.key',
    );
    addTearDown(bridge.stop);
    final cwd = await Directory('${daemon.directory.path}/project').create();
    return _Machine(daemon, bridge, cwd.path);
  }

  Future<E2ePhone> phone() async {
    final phone = await E2ePhone.pair(daemon);
    addTearDown(phone.dispose);
    await eventually(() => phone.ready, 'the phone to say hello');
    return phone;
  }
}

/// Polls [ready] until it holds: the daemon and the bridge are other
/// processes, so nothing in this one can be awaited instead.
Future<void> eventually(bool Function() ready, String what) async {
  final deadline = DateTime.now().add(const Duration(seconds: 60));
  while (!ready()) {
    if (DateTime.now().isAfter(deadline)) throw StateError('timed out: $what');
    await Future<void>.delayed(const Duration(milliseconds: 20));
  }
}

/// What was said in the finished history, in order.
List<String> _texts(AgentSessionState state) => [
  for (final item in state.history.items)
    if (item case UserMessageItem(:final text) || BlockItem(:final text)) text,
];

String? _epoch(AgentSessionState state) => positionOf(state.link)?.epoch;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    FlutterSecureStorage.setMockInitialValues(<String, String>{});
    // The test binding answers every HTTP request with an error; pairing
    // fetches the machine's identity bundle over the real LAN listener.
    HttpOverrides.global = null;
  });

  test(
    'hello, list, attach, then a prompt streams a run to its end',
    () async {
      final machine = await _Machine.start();
      final phone = await machine.phone();
      final backends = await phone.client.listBackends();
      expect((backends as Done).value, hasLength(1));
      final session = await machine.bridge.seed(machine.cwd);
      final listed = await phone.client.listSessions(
        session.backend,
        const SessionQuery(archived: false),
        const PageRequest(limit: 50),
      );
      expect([
        for (final row in (listed as Done<SessionPage>).value.items)
          row.session,
      ], contains(session));
      final controller = phone.session(session);
      await eventually(
        () => phone.state(session).history.loaded,
        'the attach and the history',
      );
      expect(_texts(phone.state(session)), ['Hello', 'Hi.']);

      await machine.bridge.script(session, 'hold');
      await controller.prompts.send(
        const PromptDraft(mode: PromptMode.start, text: 'Go'),
      );
      await eventually(
        () => phone.state(session).snapshot.run?.items.length == 2,
        'the run to stream its prompt and first block',
      );
      expect(
        phone.state(session).prompts,
        isEmpty,
        reason: 'the echo replaced it',
      );
      await machine.bridge.release(session);
      await eventually(
        () => _texts(phone.state(session)).contains('Done holding.'),
        'the finished run to come back from the transcript',
      );
      final state = phone.state(session);
      expect(_texts(state), [
        'Hello',
        'Hi.',
        'Go',
        'Working.',
        'Done holding.',
      ]);
      expect(state.history.settling, isEmpty);
      expect(state.snapshot.run, isNull);
    },
    timeout: _budget,
  );

  test('two phones are asked; the first answer wins', () async {
    final machine = await _Machine.start();
    final first = await machine.phone();
    final second = await machine.phone();
    final session = await machine.bridge.seed(machine.cwd);
    final asking = first.session(session);
    final other = second.session(session);
    for (final phone in [first, second]) {
      await eventually(
        () => phone.state(session).link is LinkLive,
        'both phones to attach',
      );
    }
    await machine.bridge.script(session, 'ask');
    await asking.prompts.send(
      const PromptDraft(mode: PromptMode.start, text: 'Ask me'),
    );
    for (final phone in [first, second]) {
      await eventually(
        () => phone.state(session).snapshot.interactions.isNotEmpty,
        'the ask to reach both phones',
      );
    }
    final interaction = first.state(session).snapshot.interactions.single;
    final problems = await Future.wait([
      asking.controls.answer(interaction, const ChoiceReply(value: 'retry')),
      other.controls.answer(interaction, const ChoiceReply(value: 'edit')),
    ]);
    expect(
      problems,
      unorderedEquals([null, 'This was already answered']),
      reason: 'both were sent; the core took the first',
    );
    for (final phone in [first, second]) {
      await eventually(
        () => phone.state(session).snapshot.interactions.isEmpty,
        'the ask to resolve on both phones',
      );
    }
    await eventually(
      () => _texts(first.state(session)).contains('Thanks.'),
      'the run to go on after the answer',
    );
  }, timeout: _budget);

  test('a reconnect replays what happened while the phone was away', () async {
    final machine = await _Machine.start();
    final phone = await machine.phone();
    final session = await machine.bridge.seed(machine.cwd);
    final controller = phone.session(session);
    await eventually(() => phone.state(session).link is LinkLive, 'the attach');
    await machine.bridge.script(session, 'hold');
    await controller.prompts.send(
      const PromptDraft(mode: PromptMode.start, text: 'Go'),
    );
    await eventually(
      () => phone.state(session).snapshot.run?.items.length == 2,
      'the run to start',
    );
    final epoch = _epoch(phone.state(session));
    await machine.daemon.restartOnNewPort();
    await eventually(
      () => phone.client.state is ContractOffline,
      'the phone to drop',
    );
    await machine.bridge.release(session);
    phone.moveTo(machine.daemon.lanCandidate);
    await eventually(
      () => _texts(phone.state(session)).contains('Done holding.'),
      'the replayed end of the run',
    );
    expect(
      _epoch(phone.state(session)),
      epoch,
      reason: 'replayed, not resnapshotted',
    );
    expect(
      _texts(phone.state(session)).where((text) => text == 'Done holding.'),
      hasLength(1),
    );
  }, timeout: _budget);

  test('a session replaced while the phone was away is followed on reconnect, '
      'with the prompt it had not sent', () async {
    final machine = await _Machine.start();
    final phone = await machine.phone();
    final session = await machine.bridge.seed(machine.cwd);
    final controller = phone.session(session);
    await eventually(() => phone.state(session).link is LinkLive, 'the attach');
    await machine.bridge.script(session, 'replace');
    await controller.prompts.send(
      const PromptDraft(mode: PromptMode.start, text: 'Clear it'),
    );
    await eventually(
      () => phone.state(session).snapshot.run?.items.length == 2,
      'the run to start',
    );
    await machine.daemon.restartOnNewPort();
    await eventually(
      () => phone.client.state is ContractOffline,
      'the phone to drop',
    );
    await controller.prompts.send(
      const PromptDraft(mode: PromptMode.queue, text: 'Then this'),
    );
    await machine.bridge.release(session);
    phone.moveTo(machine.daemon.lanCandidate);
    late final SessionRef next;
    await eventually(() {
      final link = phone.state(session).link;
      if (link is! LinkReplaced) return false;
      next = link.next;
      return true;
    }, 'the phone to be told where the conversation went on');
    expect(next, isNot(session));
    final following = phone.session(next);
    await eventually(
      () => phone.state(next).link is LinkLive,
      'the attach to the session that goes on',
    );
    await eventually(
      () => _texts(phone.state(next)).contains('Moved on.'),
      'the end of the run, under the new id',
    );
    expect(phone.state(next).notices.map((shown) => shown.text), [
      'This conversation continued in a new session',
    ]);
    expect(
      following.current.prompts.map((prompt) => prompt.input.text),
      ['Then this'],
      reason: 'the prompt typed while away came along',
    );
  }, timeout: _budget);

  test('a reconnect after the stream ended takes a fresh snapshot', () async {
    final machine = await _Machine.start();
    final phone = await machine.phone();
    final session = await machine.bridge.seed(machine.cwd);
    phone.session(session);
    await eventually(() => phone.state(session).history.loaded, 'the attach');
    final epoch = _epoch(phone.state(session));
    await machine.daemon.restartOnNewPort();
    await machine.bridge.closed(session);
    phone.moveTo(machine.daemon.lanCandidate);
    await eventually(
      () =>
          phone.state(session).link is LinkLive &&
          _epoch(phone.state(session)) != epoch,
      'the attach to a new stream',
    );
    expect(_texts(phone.state(session)), ['Hello', 'Hi.']);
  }, timeout: _budget);
}
