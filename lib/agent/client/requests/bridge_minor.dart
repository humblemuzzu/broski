import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/contract_state.dart';

/// The minor that added `includeUnavailable` to `models.list` (contract §12.4).
const minorWithUnavailableModels = 3;

extension BridgeMinor on ContractClient {
  /// Whether the bridge named at least [minor] in its `hello` answer: nothing
  /// newer is sent to a bridge that did not (contract §12.4).
  bool bridgeSpeaks(int minor) => switch (state) {
    ContractReady(:final bridgeProtocol) => bridgeProtocol.minor >= minor,
    _ => false,
  };
}
