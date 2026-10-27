import 'dart:async';
import 'dart:developer' as developer;

import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/link/discovery_provider.dart';
import 'package:broski/providers/link/lan_search_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/services/link/discovery/lan_search.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Keeps the LAN browse in step with the link: one browse runs while the app is
/// in front and the selected machine is not connected, and stops the moment
/// there is nothing left to look for.
///
/// What it finds goes into the machine record and into the live link, so a
/// machine that came back on another port is dialled without waiting out the
/// link's own backoff.
final class LinkLanDiscovery implements LanSearchSink {
  LinkLanDiscovery({
    required Ref ref,
    required Future<void> Function(Machine machine) pushEndpoint,
    required this.timing,
  }) : _ref = ref,
       _pushEndpoint = pushEndpoint;

  static const _logName = 'LinkDiscovery';

  final Ref _ref;
  final Future<void> Function(Machine machine) _pushEndpoint;
  final LanSearchTiming timing;

  final StreamController<Object> _failures =
      StreamController<Object>.broadcast();
  LanSearch? _search;
  var _hinted = false;
  var _disposed = false;

  /// A browse that could not run, once: the reason does not change when the
  /// link tries again.
  Stream<Object> get failures => _failures.stream;

  /// Starts, keeps or stops the browse to match [machine] and [status].
  void update({
    required Machine? machine,
    required LinkStatus? status,
    required bool foreground,
  }) {
    final target = lanSearchWanted(foreground: foreground, status: status)
        ? machine
        : null;
    final running = _search;
    if (running != null && target != null && running.machineId == target.id) {
      return;
    }
    running?.stop();
    _search = null;
    if (target == null) return;
    final search = LanSearch(
      browser: _ref.read(linkServiceBrowserProvider),
      machineId: target.id,
      sink: this,
      timing: timing,
    );
    _search = search;
    search.start();
  }

  @override
  void routes(List<String> routes) {
    if (_disposed) return;
    unawaited(_apply(routes));
  }

  @override
  void state(LanSearchState state) {
    if (_disposed) return;
    _ref.read(lanSearchProvider.notifier).publish(state);
  }

  @override
  void failed(Object error) {
    developer.log('lan browse failed', name: _logName, error: error);
    if (_hinted || _disposed) return;
    _hinted = true;
    if (!_failures.isClosed) _failures.add(error);
  }

  Future<void> _apply(List<String> routes) async {
    final machineId = _search?.machineId;
    if (machineId == null) return;
    final machine = await _ref
        .read(machinesProvider.notifier)
        .mergeLan(machineId, routes);
    if (machine == null) return;
    await _pushEndpoint(machine);
  }

  void dispose() {
    _disposed = true;
    _search?.stop();
    _search = null;
    unawaited(_failures.close());
  }
}
