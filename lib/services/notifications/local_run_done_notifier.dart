import 'package:broski/agent/notify/run_done_notifier.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/services/notification_service.dart';
import 'package:broski/services/notifications/notification_tap.dart';

/// The local "completed" notification every backend gets, carrying the
/// session a tap on it opens.
final class LocalRunDoneNotifier implements RunDoneNotifier {
  const LocalRunDoneNotifier();

  @override
  void runDone(RunDone done) =>
      NotificationService.instance.showSessionCompleted(
        sessionId: done.session.sessionId,
        title: done.title,
        projectName: done.project,
        duration: done.duration,
        payload: runDoneTapPayload(done.session),
      );
}

String runDoneTapPayload(SessionRef session) => NotificationTap(
  backend: session.backend.wire,
  session: session.sessionId,
).toPayload();
