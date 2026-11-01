import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/contract/generated/contract.dart';

/// What a result view may do about what its sheet is about: call the backend
/// again for the same target (the answer replaces the result shown), and
/// whether a call is on its way, during which the controls wait.
final class ResultActions {
  const ResultActions({required this.call, required this.busy});

  final Future<void> Function(BackendCall Function(OpTarget target) build) call;
  final bool busy;
}
