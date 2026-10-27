import 'package:broski/services/link/discovery/discovered_link.dart';

/// Finds the machine the link is trying to reach when the routes it already has
/// do not answer.
///
/// One browse at a time, filtered to the machine id the record pins: a browse is
/// a platform call and a radio, so a caller cannot start a second one by asking
/// twice and a stranger's advert is dropped before it costs a dial.
final class LinkDiscovery {
  LinkDiscovery({
    required this.browser,
    required this.machineId,
    required this.persist,
    this.window = linkDiscoveryWindow,
  });

  final LinkServiceBrowser browser;

  /// The machine this phone is connecting to, from the record it pinned.
  final String machineId;

  /// Where the routes that answered are kept, so the next connect tries them first.
  final Future<void> Function(List<String> routes) persist;

  final Duration window;

  Future<List<String>>? _inFlight;

  /// The `host:port` routes that answered for [machineId]; empty when nothing did.
  Future<List<String>> run() =>
      _inFlight ??= _browse().whenComplete(() => _inFlight = null);

  Future<List<String>> _browse() async {
    final List<DiscoveredLink> found;
    try {
      found = await browser.browse(window: window);
    } on Object {
      return const [];
    }
    final routes = [
      for (final candidate in found)
        if (candidate.machineId == machineId) candidate.route,
    ];
    if (routes.isEmpty) return const [];
    await persist(routes);
    return routes;
  }
}
