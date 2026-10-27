import 'dart:isolate';

import 'package:broski_link/src/connection/isolate_protocol.dart';
import 'package:broski_link/src/connection/link_close_code.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:broski_link/src/connection/link_status_reporter.dart';
import 'package:test/test.dart';

void main() {
  late ReceivePort port;
  late LinkStatusReporter reporter;
  late List<LinkStatus> statuses;

  setUp(() {
    port = ReceivePort();
    reporter = LinkStatusReporter(port.sendPort);
    statuses = [];
    port.listen((Object? message) {
      if (message is LinkIsolateStatus) {
        statuses.add(message.status);
      }
    });
  });

  tearDown(() => port.close());

  Future<List<LinkStatus>> reported() async {
    for (var round = 0; round < 5; round++) {
      await Future<void>.delayed(Duration.zero);
    }
    return statuses;
  }

  test('a repeat of the same status is not sent twice', () async {
    reporter.report(LinkConnectionState.waiting, route: LinkRoute.relay);
    reporter.report(LinkConnectionState.waiting, route: LinkRoute.relay);

    expect(await reported(), hasLength(1));
  });

  test('two resets in a row both reach the app', () async {
    reporter.report(
      LinkConnectionState.connected,
      route: LinkRoute.relay,
      resumed: false,
      sessionReset: true,
    );
    reporter.report(
      LinkConnectionState.connected,
      route: LinkRoute.relay,
      resumed: false,
      sessionReset: true,
    );

    final seen = await reported();
    expect(seen, hasLength(2));
    expect(seen.every((status) => status.sessionReset), isTrue);
  });

  test('resumed is cleared as soon as the link is not connected', () async {
    reporter.report(
      LinkConnectionState.connected,
      route: LinkRoute.relay,
      resumed: true,
    );
    reporter.report(LinkConnectionState.waiting, route: LinkRoute.relay);

    final seen = await reported();
    expect(seen.first.resumed, isTrue);
    expect(seen.last.resumed, isNull);
  });

  test('the close code rides along with the close', () async {
    reporter.report(
      LinkConnectionState.connected,
      route: LinkRoute.relay,
      resumed: true,
    );
    reporter.report(
      LinkConnectionState.closed,
      closeCode: LinkCloseCode.revoked,
    );

    final seen = await reported();
    expect(seen.last.closeCode, LinkCloseCode.revoked);
    expect(seen.last.state, LinkConnectionState.closed);
  });
}
