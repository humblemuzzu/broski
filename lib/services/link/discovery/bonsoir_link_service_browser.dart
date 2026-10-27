import 'dart:async';

import 'package:bonsoir/bonsoir.dart';
import 'package:broski/services/link/discovery/discovered_link.dart';

/// The platform's own Bonjour: `NWBrowser` on Apple platforms and `NsdManager`
/// on Android, both reached through a platform channel, so this runs on the main
/// isolate and its results are handed to the link isolate as routes.
///
/// The plugin is configured for the `local.` domain and the TCP transport, which
/// is what a DNS-SD advertisement of `_broski-link._tcp` is.
final class BonsoirLinkServiceBrowser implements LinkServiceBrowser {
  BonsoirLinkServiceBrowser({this.type = linkDiscoveryServiceType});

  final String type;

  @override
  Future<List<DiscoveredLink>> browse({required Duration window}) async {
    final discovery = BonsoirDiscovery(type: type);
    final found = <DiscoveredLink>[];
    try {
      await discovery.initialize();
      final events = discovery.eventStream;
      if (events == null) return const [];
      final subscription = events.listen((event) {
        _onEvent(event, discovery, found);
      });
      try {
        await discovery.start();
        await Future<void>.delayed(window);
      } finally {
        await subscription.cancel();
      }
    } on Object {
      return const [];
    } finally {
      await _stop(discovery);
    }
    return found;
  }

  void _onEvent(
    BonsoirDiscoveryEvent event,
    BonsoirDiscovery discovery,
    List<DiscoveredLink> into,
  ) {
    switch (event) {
      case BonsoirDiscoveryServiceFoundEvent():
        // The host is only known once the service is resolved.
        unawaited(
          event.service
              .resolve(discovery.serviceResolver)
              .catchError((Object _) {}),
        );
      case BonsoirDiscoveryServiceResolvedEvent():
        final service = event.service;
        final candidate = DiscoveredLink.fromAdvertisement(
          attributes: service.attributes,
          host: service.host,
          port: service.port,
        );
        if (candidate == null) return;
        if (into.any((entry) => entry.route == candidate.route)) return;
        into.add(candidate);
      default:
        return;
    }
  }

  Future<void> _stop(BonsoirDiscovery discovery) async {
    try {
      await discovery.stop();
    } on Object {
      // A browse that never started has nothing to stop.
    }
  }
}
