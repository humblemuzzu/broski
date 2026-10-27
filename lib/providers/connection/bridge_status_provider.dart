import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Where the link controller publishes the bridge state the daemon reports.
final bridgeLinkStatusProvider =
    StateNotifierProvider<BridgeLinkStatusSink, BridgeLinkStatus?>(
      (ref) => BridgeLinkStatusSink(),
    );

class BridgeLinkStatusSink extends StateNotifier<BridgeLinkStatus?> {
  BridgeLinkStatusSink() : super(null);

  void publish(BridgeLinkStatus? status) => state = status;
}
