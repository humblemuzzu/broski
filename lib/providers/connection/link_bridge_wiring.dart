import 'dart:async';

import 'package:broski/providers/connection/bridge_status_provider.dart';
import 'package:broski/providers/connection/bridge_status_tracker.dart';
import 'package:broski/providers/connection/link_status_mapping.dart';
import 'package:broski/services/bridge/bridge_reset_exception.dart';
import 'package:broski/services/link/link_send_failure_notice.dart';
import 'package:broski_link/broski_link.dart';

/// The controller's bridge side: what the daemon reports about its bridge, and
/// what the link refused to carry.
final class LinkBridgeWiring {
  LinkBridgeWiring({
    required LinkStatusPublisher publisher,
    required BridgeLinkStatusSink sink,
    required void Function(BridgeResetReason reason) onReset,
    required void Function(String requestId, LinkSendFailureReason reason)
    onRefused,
    required StreamController<LinkSendFailure> announcements,
  }) : _sink = sink,
       _onRefused = onRefused,
       _announcements = announcements,
       _tracker = BridgeStatusTracker(publisher: publisher, onReset: onReset);

  final BridgeLinkStatusSink _sink;
  final void Function(String requestId, LinkSendFailureReason reason)
  _onRefused;
  final StreamController<LinkSendFailure> _announcements;
  final BridgeStatusTracker _tracker;

  void onLinkStatus(LinkStatus status) => _tracker.onLinkStatus(status);

  /// The state reaches the chip whether or not it is news for the resync.
  void onBridgeStatus(BridgeLinkStatus status) {
    _sink.publish(status);
    _tracker.onBridgeStatus(status);
  }

  /// A refusal that names a request fails it here rather than at its timeout,
  /// and only a refused message the user sent is worth a notice.
  void onSendFailure(LinkSendFailure failure) {
    final tag = failure.tag;
    if (tag != null) {
      _onRefused(tag, failure.reason);
    }
    if (shouldAnnounceLinkSendFailure(failure) && !_announcements.isClosed) {
      _announcements.add(failure);
    }
  }

  void reset() => _tracker.reset();
}
