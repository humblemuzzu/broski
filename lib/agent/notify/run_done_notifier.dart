import 'package:broski/contract/generated/contract.dart';

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
