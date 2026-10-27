import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/bridge/bridge_reset_exception.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Fails every request still waiting for a reply the bridge no longer has,
/// whoever is holding it: one reset reaches the main bridge and the Pi backend
/// alike, so neither sits out its own timeout for an answer that cannot come.
final class BridgeResetFanout {
  const BridgeResetFanout(this._ref);

  final Ref _ref;

  void failAll(BridgeResetReason reason) {
    _ref.read(bridgeServiceProvider).failPendingBridgeRequests(reason);
    _ref.read(piBridgeServiceProvider).failPendingRequests(reason);
  }
}

final bridgeResetFanoutProvider = Provider<BridgeResetFanout>(
  (ref) => BridgeResetFanout(ref),
);
