import 'package:broski/services/link/discovery/discovered_link.dart';

/// What a running browse reports about one advert.
sealed class LinkBrowseEvent {
  const LinkBrowseEvent(this.link);

  final DiscoveredLink link;
}

final class LinkAdvertised extends LinkBrowseEvent {
  const LinkAdvertised(super.link);
}

final class LinkUnadvertised extends LinkBrowseEvent {
  const LinkUnadvertised(super.link);
}

/// Browses the LAN for what the machines on it advertise.
///
/// One browse stays open until its subscription is cancelled: the machine a
/// phone wants can move to another port at any moment. An error means the browse
/// cannot run at all — no radio, or no local-network permission.
abstract interface class LinkServiceBrowser {
  Stream<LinkBrowseEvent> watch();
}
