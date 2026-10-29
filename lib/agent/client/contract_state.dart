import 'package:broski/contract/generated/contract.dart';

/// Where the client stands with the bridge: the protocol is usable only once
/// `hello` agreed a major version on the current connection (contract §12.4).
sealed class ContractState {
  const ContractState();
}

final class ContractOffline extends ContractState {
  const ContractOffline();
}

final class ContractNegotiating extends ContractState {
  const ContractNegotiating();
}

final class ContractReady extends ContractState {
  const ContractReady({
    required this.generation,
    required this.bridgeProtocol,
    required this.bridgeVersion,
  });

  /// One more on every successful `hello`: a new generation means the bridge
  /// may have forgotten this client, so sessions are attached again.
  final int generation;

  /// The client never sends anything newer than this minor (contract §12.4).
  final ProtocolVersion bridgeProtocol;
  final String bridgeVersion;
}

final class ContractIncompatible extends ContractState {
  const ContractIncompatible(this.detail);

  final String detail;
}
