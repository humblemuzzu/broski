import 'dart:async';

import 'package:broski_link/src/connection/link_socket.dart';
import 'package:broski_link/src/connection/link_status.dart';
import 'package:broski_link/src/connection/route_race.dart';

/// Runs [callback] after [delay]; injectable so the race is testable.
typedef LinkScheduler = void Function(Duration delay, void Function() callback);

void scheduleAfter(Duration delay, void Function() callback) =>
    Timer(delay, callback);

/// Opens the relay socket and every LAN candidate at once and hands back the
/// winner of [RouteRace]. Losing sockets are closed, cancelled dials are closed
/// when they arrive.
final class RouteDialer {
  RouteDialer({
    required this.dial,
    this.grace = const Duration(milliseconds: 300),
    this.lanTimeout = const Duration(seconds: 4),
    this.relayTimeout = const Duration(seconds: 12),
    this.schedule = scheduleAfter,
  });

  final LinkSocketDial dial;

  /// How long the relay socket waits for a LAN candidate to open.
  final Duration grace;
  final Duration lanTimeout;
  final Duration relayTimeout;
  final LinkScheduler schedule;

  _Race? _race;

  void start({
    required List<Uri> lan,
    required Uri? relay,
    required void Function(LinkSocket socket) onChosen,
    required void Function() onExhausted,
  }) {
    cancel();
    final race = _Race(
      RouteRace(lanCandidates: lan.length),
      onChosen,
      onExhausted,
    )..pending = lan.length + (relay == null ? 0 : 1);
    _race = race;
    for (var index = 0; index < lan.length; index++) {
      unawaited(_openLan(race, index, lan[index]));
    }
    if (relay != null) {
      unawaited(_openRelay(race, relay));
    }
    _settle(race);
  }

  /// A socket of the running attempt died before it was chosen.
  void socketFailed(LinkSocket socket) {
    final race = _race;
    if (race == null || !identical(socket, race.relay)) {
      return;
    }
    race.relay = null;
    race.race.relayFailed();
    _settle(race);
  }

  /// Abandons the attempt; dials that finish later close themselves.
  void cancel() => _race = null;

  Future<void> _openLan(_Race race, int index, Uri uri) async {
    try {
      final socket = await dial(
        uri: uri,
        route: LinkRoute.lan,
        timeout: lanTimeout,
      );
      if (!identical(_race, race)) {
        unawaited(socket.close());
        return;
      }
      race.lan[index] = socket;
      race.race.lanOpened(index);
      race.pending--;
      _settle(race);
    } on Object {
      if (!identical(_race, race)) {
        return;
      }
      race.race.lanFailed();
      race.pending--;
      _settle(race);
    }
  }

  Future<void> _openRelay(_Race race, Uri uri) async {
    try {
      final socket = await dial(
        uri: uri,
        route: LinkRoute.relay,
        timeout: relayTimeout,
      );
      if (!identical(_race, race)) {
        unawaited(socket.close());
        return;
      }
      race.relay = socket;
      race.race.relayOpened();
      race.pending--;
      _settle(race);
    } on Object {
      if (!identical(_race, race)) {
        return;
      }
      race.race.relayFailed();
      race.pending--;
      _settle(race);
    }
  }

  void _settle(_Race race) {
    if (!identical(_race, race)) {
      return;
    }
    if (race.race.choice != RouteChoice.wait) {
      _choose(race);
      return;
    }
    if (race.race.awaitingGrace && !race.graceArmed) {
      race.graceArmed = true;
      schedule(grace, () {
        if (!identical(_race, race)) {
          return;
        }
        race.race.graceElapsed();
        _settle(race);
      });
    }
    if (race.pending == 0) {
      _race = null;
      race.onExhausted();
    }
  }

  void _choose(_Race race) {
    final winner = race.race.choice == RouteChoice.lan
        ? race.lan[race.race.lanIndex!]!
        : race.relay!;
    _race = null;
    for (final socket in race.lan) {
      if (socket != null && !identical(socket, winner)) {
        unawaited(socket.close());
      }
    }
    final relay = race.relay;
    if (relay != null && !identical(relay, winner)) {
      unawaited(relay.close());
    }
    race.onChosen(winner);
  }
}

final class _Race {
  _Race(this.race, this.onChosen, this.onExhausted)
    : lan = List<LinkSocket?>.filled(race.lanCandidates, null);

  final RouteRace race;
  final void Function(LinkSocket socket) onChosen;
  final void Function() onExhausted;
  final List<LinkSocket?> lan;
  LinkSocket? relay;
  var pending = 0;
  var graceArmed = false;
}
