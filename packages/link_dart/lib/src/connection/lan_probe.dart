import 'dart:async';

import 'package:broski_link/src/connection/lan_probe_policy.dart';
import 'package:broski_link/src/connection/link_socket.dart';
import 'package:broski_link/src/connection/link_status.dart';

/// Dials LAN candidates one at a time while the relay carries the link and
/// hands the first socket that opens to [onOpened].
///
/// Every stop bumps a generation, so a dial that answers after the link moved
/// closes itself instead of reporting.
final class LanProbe {
  LanProbe({
    required this.dial,
    required this.onOpened,
    required this.clock,
    LanProbePolicy? policy,
  }) : policy = policy ?? LanProbePolicy();

  final LinkSocketDial dial;
  final void Function(LinkSocket socket) onOpened;
  final Duration Function() clock;
  final LanProbePolicy policy;

  Timer? _timer;
  List<Uri> _queue = const [];
  var _hosts = const <Uri>[];
  var _eligible = false;
  var _running = false;
  var _generation = 0;

  /// Starts, keeps or stops probing for [hosts].
  void sync({required bool eligible, required List<Uri> hosts}) {
    _eligible = eligible;
    _hosts = hosts;
    if (!eligible || hosts.isEmpty) {
      stop();
      return;
    }
    _arm();
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    _queue = const [];
    _running = false;
    _generation++;
    policy.resume(clock());
  }

  void _arm() {
    if (_timer != null || _running || !_eligible) {
      return;
    }
    final due = policy.dueAt;
    if (due == null) {
      return;
    }
    final delay = due - clock();
    _timer = Timer(delay.isNegative ? Duration.zero : delay, _start);
  }

  void _start() {
    _timer = null;
    if (!_eligible || !policy.start(clock())) {
      _arm();
      return;
    }
    _queue = List<Uri>.of(_hosts);
    _running = true;
    _next(++_generation);
  }

  Future<void> _next(int generation) async {
    final queue = _queue;
    if (generation != _generation || queue.isEmpty) {
      _finish(generation);
      return;
    }
    try {
      final socket = await dial(
        uri: queue.removeAt(0),
        route: LinkRoute.lan,
        timeout: policy.timeout,
      );
      if (generation != _generation) {
        unawaited(socket.close());
        return;
      }
      _queue = const [];
      _generation++;
      _running = false;
      policy.end(clock());
      onOpened(socket);
    } on Object {
      if (generation != _generation) {
        return;
      }
      await _next(generation);
    }
  }

  void _finish(int generation) {
    if (generation != _generation) {
      return;
    }
    _queue = const [];
    _running = false;
    _generation++;
    policy.end(clock());
    _arm();
  }
}
