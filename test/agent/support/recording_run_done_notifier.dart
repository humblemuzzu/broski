import 'package:broski/agent/notify/run_done_notifier.dart';

/// Keeps every finished run it is told about, in order.
final class RecordingRunDoneNotifier implements RunDoneNotifier {
  final List<RunDone> done = [];

  @override
  void runDone(RunDone done) => this.done.add(done);
}
