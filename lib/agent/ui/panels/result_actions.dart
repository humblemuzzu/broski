import 'package:broski/contract/generated/contract.dart';

/// What a result view may do about the session its sheet is about: call the
/// backend again for it (the answer replaces the result shown), and whether a
/// call is on its way, during which the controls wait.
final class ResultActions {
  const ResultActions({required this.call, required this.busy});

  final Future<void> Function(BackendCall Function(SessionId sessionId) build)
  call;
  final bool busy;
}
