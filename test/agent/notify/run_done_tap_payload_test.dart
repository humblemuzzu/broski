import 'package:broski/contract/generated/contract.dart';
import 'package:broski/services/notifications/local_run_done_notifier.dart';
import 'package:broski/services/notifications/notification_tap.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('a run-done notification opens the session it is about', () {
    const session = SessionRef(backend: BackendId.pi, sessionId: 's-42');

    expect(
      NotificationTap.parse(runDoneTapPayload(session)),
      const NotificationTap(backend: 'pi', session: 's-42'),
    );
  });
}
