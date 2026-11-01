import 'package:broski/contract/generated/contract.dart';

/// The `backend.call` that carries [op] to the backend [session] belongs to
/// (contract §13). One op kind may be in several backends' unions, so the
/// session says which call wraps it: its backend id goes into the call as it
/// came, never read. A backend whose union has no such op makes the call
/// throw a [FormatException]; a panel is only offered for an op the backend
/// lists in `backendOps`.
BackendCall opCall(SessionRef session, BackendOp op) => BackendCall.fromJson({
  'backend': session.toJson()['backend'],
  'op': op.toJson(),
});
