import 'package:broski/contract/generated/contract.dart';

/// The `backend.call` that carries [op] (contract §13). Every op the generic
/// screens send belongs to one of the contract's unions of ops, so this is the
/// one place that names the call wrapping it.
BackendCall opCall(PiOp op) => PiCall(op: op);
