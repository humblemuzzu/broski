import 'package:broski/contract/generated/contract.dart';
import 'package:broski/services/notification_service.dart'
    show NotificationService;

/// A run that finished in a session the person was not looking at.
final class RunDone {
  const RunDone({
    required this.session,
    required this.title,
    required this.project,
    required this.duration,
  });

  final SessionRef session;
  final String title;

  /// The directory's name, the way the other backends' notifications put it.
  final String project;

  /// How long the phone saw the session busy.
  final Duration duration;
}

abstract interface class RunDoneNotifier {
  void runDone(RunDone done);
}

/// The local "completed" notification every backend gets.
final class LocalRunDoneNotifier implements RunDoneNotifier {
  const LocalRunDoneNotifier();

  @override
  void runDone(RunDone done) =>
      NotificationService.instance.showSessionCompleted(
        sessionId: done.session.sessionId,
        title: done.title,
        projectName: done.project,
        duration: done.duration,
      );
}
