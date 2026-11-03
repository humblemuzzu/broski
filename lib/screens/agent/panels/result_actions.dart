import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/op_panel.dart';

/// What a result view may do about what its sheet is about, and whether a
/// call is on its way, during which the controls wait.
final class ResultActions {
  const ResultActions({
    required this.call,
    required this.attempt,
    required this.busy,
  });

  /// Calls the backend again for the same target; the answer replaces the
  /// result shown, and a refusal is told above it.
  final Future<void> Function(BackendCall Function(OpTarget target) build) call;

  /// Calls the backend and hands back how it ended, touching nothing shown:
  /// for a view that keeps its own place (a file open beside its list) and
  /// words each refusal itself.
  final Future<Outcome<BackendOpResult>> Function(
    BackendCall Function(OpTarget target) build,
  )
  attempt;

  final bool busy;
}
