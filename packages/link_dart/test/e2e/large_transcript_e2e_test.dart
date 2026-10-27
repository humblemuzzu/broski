@Tags(['e2e'])
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

import 'bridge_session.dart';
import 'cc_transcript_fixture.dart';
import 'real_machine.dart';

const Timeout _budget = Timeout(Duration(seconds: 600));

/// The page size the app asks for. Large enough that a page is megabytes, small
/// enough that it stays well under the bridge's reply cap.
const int pageLimit = 200;

/// The largest single reply a link socket is given (`BROSKI_LINK_MESSAGE_MB`).
const int replyLimit = 8 * 1024 * 1024;

/// How many pages test C keeps in flight while the phone is not reading.
const int burstPages = 6;

String megabytes(int bytes) => (bytes / (1024 * 1024)).toStringAsFixed(1);

List<String> idsOf(Map<String, Object?> reply) => <String>[
  for (final message in reply['data']! as List<Object?>)
    (message! as Map)['id'] as String,
];

void main() {
  late CcTranscriptFixture fixture;

  /// A machine whose bridge's own home holds [fixture], and nothing real.
  Future<Machine> machineFor({bool pausable = false}) => startMachine(
    pausable: pausable,
    prepare: (sandbox) async {
      fixture = await CcTranscriptFixture.create(sandbox);
    },
  );

  /// What the app does when it opens a chat: register, then name the session.
  /// Reports the conn of the bridge socket it was served from.
  Future<int> openTranscript(Machine machine) async {
    final up = await machine.phone.awaitBridgeStatus(
      (status) => status.state == BridgeStatusState.up,
    );
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
    machine.phone.sendBridge(
      jsonEncode(setView(sessionId: fixtureSessionId, cwd: fixture.cwd)),
    );
    return up.conn;
  }

  Future<Map<String, Object?>> page(BridgeSession session, {String? before}) =>
      session.request(
        ccGetSessionMessages(
          session.key(),
          sessionId: fixtureSessionId,
          cwd: fixture.cwd,
          limit: pageLimit,
          before: before,
        ),
        timeout: const Duration(seconds: 120),
      );

  /// The cursor that walks to page [index] counting back from the tail, which
  /// the fixture knows, so a test can send pages out before they are answered.
  String? cursorFor(int index) =>
      index == 0 ? null : '${fixture.messages.length - index * pageLimit}';

  test(
    'pages a large real transcript over the link, every message once',
    () async {
      final machine = await machineFor();
      final session = machine.session;
      await openTranscript(machine);

      // The transcript lives in the sandbox's own home: if the bridge read the
      // developer's ~/.claude instead, this session could not be found at all.
      final listed = await session.request(
        unifiedListSessions(
          session.key(),
          backend: 'claude-code',
          cwd: fixture.cwd,
        ),
      );
      expect(listed['type'], 'unified_sessions');
      expect(listed['backend'], 'claude-code');
      expect(
        <Object?>[
          for (final entry in listed['data']! as List<Object?>)
            (entry! as Map)['id'],
        ],
        contains(fixtureSessionId),
        reason: 'the bridge reads the sandbox home, not the developer\'s',
      );

      final outputs = <String, int>{};
      final roles = <String>[];
      final pages = <List<String>>[];
      final clock = Stopwatch()..start();
      String? before;
      while (true) {
        final reply = await page(session, before: before);
        expect(reply['type'], 'cc_session_messages');
        pages.add(idsOf(reply));
        for (final message in reply['data']! as List<Object?>) {
          final data = message! as Map;
          roles.add(data['role'] as String);
          final calls = data['toolCalls'];
          for (final call in (calls as List<Object?>?) ?? const <Object?>[]) {
            final tool = call! as Map;
            outputs[tool['toolUseId'] as String] =
                (tool['output'] as String?)?.length ?? 0;
          }
        }
        if (reply['hasMore'] != true) {
          expect(
            reply['nextCursor'],
            isNull,
            reason: 'the last page is the end',
          );
          break;
        }
        before = reply['nextCursor']! as String;
      }
      clock.stop();

      expect(pages, <List<String>>[
        for (final page in fixture.pages(pageLimit))
          <String>[for (final message in page) message.id],
      ], reason: 'each page is exactly the slice its cursor names');
      final ordered = <String>[for (final page in pages.reversed) ...page];
      expect(ordered, fixture.ids, reason: 'every message once, in file order');
      expect(
        ordered.toSet(),
        hasLength(ordered.length),
        reason: 'nothing twice',
      );
      expect(roles, <String>[
        for (final message in fixture.messages) message.role,
      ], reason: 'every message arrived with its role');
      expect(
        outputs,
        fixture.toolOutputs,
        reason: 'every tool result arrived whole, with its output intact',
      );

      stdout.writeln(
        'paged ${fixture.messages.length} messages in ${pages.length} pages from '
        'a ${megabytes(fixture.bytes)} MB transcript: '
        '${megabytes(machine.phone.bridgeBytes)} MB over the link in '
        '${clock.elapsedMilliseconds} ms',
      );
      expectLinkSurvived(machine.phone);
      expectCleanReplies(session);
    },
    timeout: _budget,
  );

  test(
    'one unbounded transcript request is refused, not a dead link',
    () async {
      final machine = await machineFor();
      final session = machine.session;
      final conn = await openTranscript(machine);
      final statusesFrom = machine.phone.bridgeStatus.length;

      final key = session.key();
      final reply = await session.request(
        ccGetSessionMessages(
          key,
          sessionId: fixtureSessionId,
          cwd: fixture.cwd,
        ),
        timeout: const Duration(seconds: 180),
      );

      expect(reply['type'], 'error');
      expect(reply['code'], 'response_too_large');
      expect(reply['requestId'], key, reason: 'the refusal names the request');
      expect(reply['limit'], replyLimit);
      expect(
        reply['bytes'],
        greaterThan(replyLimit),
        reason: 'the transcript is ${megabytes(fixture.bytes)} MB on its own',
      );
      expect(reply['message'], isA<String>());

      final pong = await session.request(clientPing(session.key(), 1));
      expect(pong['type'], 'client_pong', reason: 'the link still answers');
      expect(
        machine.phone.bridgeConn,
        conn,
        reason: 'the bridge socket was never replaced',
      );
      expect(
        machine.phone.bridgeStatus.sublist(statusesFrom),
        isEmpty,
        reason: 'the machine reported no change for this bridge socket',
      );
      expectLinkSurvived(machine.phone);
      expect(session.errors, 1, reason: 'the refusal is the only error');
      expect(session.duplicates, 0, reason: 'nothing arrived twice');
      expect(
        session.unsolicited,
        0,
        reason: 'nothing named an unknown request',
      );
      expect(session.misnamed, 0, reason: 'every reply names its request');
      expect(
        session.outstanding,
        isEmpty,
        reason: 'no request was left waiting',
      );
    },
    timeout: _budget,
  );

  test(
    'a phone that stops reading for three seconds still gets the burst',
    () async {
      final machine = await machineFor(pausable: true);
      final forwarder = machine.forwarder!;
      final phone = machine.phone;
      final session = machine.session;
      final conn = await openTranscript(machine);

      final burst = fixture.pages(pageLimit).take(burstPages).toList();
      expect(
        burst,
        hasLength(burstPages),
        reason: 'the fixture pages that far',
      );
      final requests = <Map<String, Object?>>[
        for (var index = 0; index < burst.length; index++)
          ccGetSessionMessages(
            session.key(),
            sessionId: fixtureSessionId,
            cwd: fixture.cwd,
            limit: pageLimit,
            before: cursorFor(index),
          ),
      ];

      final clock = Stopwatch()..start();
      forwarder.pause();
      final pending = <Future<Map<String, Object?>>>[
        for (final request in requests)
          session.request(request, timeout: const Duration(seconds: 120)),
      ];
      await Future<void>.delayed(const Duration(seconds: 3));
      expect(
        session.outstanding,
        isNotEmpty,
        reason: 'a phone that reads nothing cannot have been answered',
      );
      expect(
        phone.statuses.where((status) => status.sessionReset),
        isEmpty,
        reason: 'the link held the phone instead of dropping it',
      );
      forwarder.resume();
      final replies = await Future.wait(pending);
      clock.stop();

      for (var index = 0; index < replies.length; index++) {
        expect(idsOf(replies[index]), <String>[
          for (final message in burst[index]) message.id,
        ], reason: 'page $index arrived whole and in order');
      }
      stdout.writeln(
        '$burstPages pages in flight through a 3 s stall: '
        '${megabytes(phone.bridgeBytes)} MB in ${clock.elapsedMilliseconds} ms',
      );

      expect(phone.bridgeConn, conn, reason: 'the bridge socket survived');
      expectLinkSurvived(phone);
      expectCleanReplies(session);
    },
    timeout: _budget,
  );

  test(
    'a bridge that dies mid-page is reported, and paging carries on',
    () async {
      final machine = await machineFor();
      final phone = machine.phone;
      final session = machine.session;
      final conn = await openTranscript(machine);

      final newest = await page(session);
      expect(idsOf(newest), <String>[
        for (final message in fixture.pages(pageLimit).first) message.id,
      ], reason: 'the transcript is served before the crash');
      final cursor = newest['nextCursor']! as String;
      final expected = <String>[
        for (final message in fixture.pages(pageLimit)[1]) message.id,
      ];

      final from = phone.bridgeStates.length;
      final statusesFrom = phone.bridgeStatus.length;
      var answered = false;
      Map<String, Object?>? answer;
      final inFlight = session.request(
        ccGetSessionMessages(
          session.key(),
          sessionId: fixtureSessionId,
          cwd: fixture.cwd,
          limit: pageLimit,
          before: cursor,
        ),
        timeout: const Duration(seconds: 60),
      );
      unawaited(
        inFlight.then((value) {
          answered = true;
          answer = value;
        }, onError: (Object _) => answered = true),
      );

      final killedAt = DateTime.now();
      await machine.bridge.crash();
      // A reset is any status the machine reports for this socket, which is what
      // makes the app fail its pending requests. Ten seconds covers the
      // supervisor's one second restart plus the pump's redial backoff, and is
      // far inside the app's own thirty second request timeout.
      final deadline = killedAt.add(const Duration(seconds: 10));
      while (!answered &&
          phone.bridgeStatus.length == statusesFrom &&
          DateTime.now().isBefore(deadline)) {
        await Future<void>.delayed(const Duration(milliseconds: 20));
      }
      final waited = DateTime.now().difference(killedAt);
      expect(
        answered || phone.bridgeStatus.length > statusesFrom,
        isTrue,
        reason:
            'the reply or a bridge reset, never silence: waited '
            '${waited.inMilliseconds} ms for one of them',
      );
      stdout.writeln(
        'the request in flight when the bridge was killed settled in '
        '${waited.inMilliseconds} ms '
        '(${answered ? 'answered' : 'settled by the bridge reset'})',
      );

      await phone.awaitBridgeState('crashed', from: from);
      await phone.awaitBridgeState('starting', from: from);
      await phone.awaitBridgeState('up', from: from);
      expect(
        phone.bridgeStates.sublist(from),
        containsAllInOrder(<String>['crashed', 'starting', 'up']),
        reason: 'the crash, the restart and the recovery reach the phone',
      );
      expect(
        phone.bridgeConn,
        greaterThan(conn),
        reason: 'the new bridge is a new socket for this session',
      );

      final fresh = await page(session, before: cursor);
      expect(
        idsOf(fresh),
        expected,
        reason: 'paging continues on the new bridge',
      );
      if (answer != null) {
        expect(
          idsOf(answer!),
          expected,
          reason: 'the lost page, if it came back',
        );
      }
      expect(session.duplicates, 0, reason: 'nothing arrived twice');
      expect(
        session.unsolicited,
        0,
        reason: 'nothing named an unknown request',
      );
      expect(phone.sendFailures, isEmpty, reason: 'the link refused nothing');
    },
    timeout: _budget,
  );
}
