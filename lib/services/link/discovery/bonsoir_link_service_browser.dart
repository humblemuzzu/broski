import 'dart:async';

import 'package:bonsoir/bonsoir.dart';
import 'package:broski/services/link/discovery/discovered_link.dart';
import 'package:broski/services/link/discovery/link_service_browser.dart';

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
  Stream<LinkBrowseEvent> watch() => _Browse(type).events;
}

/// One open browse, from the platform's start to its stop.
///
/// Every event it emits is one advert appearing or going away, so a caller that
/// keeps listening hears about a daemon restarted on another port.
final class _Browse {
  _Browse(this.type) {
    _events.onListen = () => unawaited(_start());
    _events.onCancel = _stop;
  }

  final String type;
  final StreamController<LinkBrowseEvent> _events =
      StreamController<LinkBrowseEvent>.broadcast();

  /// The adverts currently reported, by the instance name the platform uses.
  final Map<String, DiscoveredLink> _live = <String, DiscoveredLink>{};
  BonsoirDiscovery? _discovery;
  StreamSubscription<BonsoirDiscoveryEvent>? _subscription;

  Stream<LinkBrowseEvent> get events => _events.stream;

  Future<void> _start() async {
    if (_discovery != null) return;
    final discovery = BonsoirDiscovery(type: type);
    try {
      await discovery.initialize();
      final stream = discovery.eventStream;
      if (stream == null) {
        _fail(StateError('the platform opened no browse for $type'));
        return;
      }
      _discovery = discovery;
      _subscription = stream.listen(_onEvent, onError: _fail);
      await discovery.start();
    } on Object catch (error) {
      _fail(error);
    }
  }

  Future<void> _stop() async {
    final subscription = _subscription;
    final discovery = _discovery;
    _subscription = null;
    _discovery = null;
    _live.clear();
    await subscription?.cancel();
    if (discovery == null) return;
    try {
      await discovery.stop();
    } on Object {
      // A browse that never started has nothing to stop.
    }
  }

  void _onEvent(BonsoirDiscoveryEvent event) {
    switch (event) {
      case BonsoirDiscoveryServiceFoundEvent():
        // The host is only known once the service is resolved.
        final discovery = _discovery;
        if (discovery == null) return;
        unawaited(
          event.service
              .resolve(discovery.serviceResolver)
              .catchError((Object _) {}),
        );
      case BonsoirDiscoveryServiceResolvedEvent():
      case BonsoirDiscoveryServiceUpdatedEvent():
        final service = event.service;
        if (service == null) return;
        _advertise(service);
      case BonsoirDiscoveryServiceLostEvent():
        _gone(event.service.name);
      default:
        return;
    }
  }

  void _advertise(BonsoirService service) {
    final candidate = DiscoveredLink.fromAdvertisement(
      attributes: service.attributes,
      host: service.host,
      port: service.port,
    );
    if (candidate == null) return;
    final previous = _live[service.name];
    if (previous?.route == candidate.route) return;
    _live[service.name] = candidate;
    if (previous != null) _events.add(LinkUnadvertised(previous));
    _events.add(LinkAdvertised(candidate));
  }

  void _gone(String name) {
    final previous = _live.remove(name);
    if (previous != null) _events.add(LinkUnadvertised(previous));
  }

  /// The browse cannot run: no radio, or the app may not look at the network.
  void _fail(Object error) {
    if (_events.isClosed) return;
    _events.addError(error);
    unawaited(_stop());
    unawaited(_events.close());
  }
}
