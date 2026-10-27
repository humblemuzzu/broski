/// The DNS-SD service a `broski-link` daemon advertises on the LAN, and the
/// window one browse is given.
const linkDiscoveryServiceType = '_broski-link._tcp';
const linkDiscoveryWindow = Duration(seconds: 3);

/// The TXT record keys the daemon writes, and the only ones read here.
const linkDiscoveryIdKey = 'id';
const linkDiscoveryVersionKey = 'v';
const linkDiscoveryVersion = '1';

/// One advertised daemon: the machine it claims to be and where it answers.
///
/// The claim is not trusted — the Noise handshake authenticates the machine on
/// the socket itself — so a spoofed advert can only cost a dial.
final class DiscoveredLink {
  const DiscoveredLink({
    required this.machineId,
    required this.host,
    required this.port,
  });

  final String machineId;
  final String host;
  final int port;

  /// The `host:port` form a machine record's `lan` holds.
  String get route => port > 0 ? '$host:$port' : host;

  /// Builds a candidate from one resolved service, or null when the TXT record
  /// does not name a machine or does not speak this version.
  static DiscoveredLink? fromAdvertisement({
    required Map<String, String> attributes,
    required String? host,
    required int port,
  }) {
    if (host == null || host.isEmpty || port <= 0) return null;
    if (attributes[linkDiscoveryVersionKey] != linkDiscoveryVersion) {
      return null;
    }
    final id = attributes[linkDiscoveryIdKey]?.trim() ?? '';
    if (id.isEmpty) return null;
    return DiscoveredLink(machineId: id, host: host, port: port);
  }

  @override
  String toString() => 'DiscoveredLink($machineId, $route)';
}

/// Browses the LAN for what a machine advertises.
///
/// An implementation is the platform's own Bonjour (a platform channel, so it
/// runs on the main isolate) and gives the browse its own bounded window.
abstract interface class LinkServiceBrowser {
  Future<List<DiscoveredLink>> browse({required Duration window});
}
