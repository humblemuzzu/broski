import 'package:broski_link/src/connection/route_race.dart';
import 'package:test/test.dart';

void main() {
  test('a relay with no LAN candidate wins at once', () {
    final race = RouteRace(lanCandidates: 0);
    expect(race.choice, RouteChoice.wait);
    race.relayOpened();
    expect(race.choice, RouteChoice.relay);
    expect(race.awaitingGrace, isFalse);
  });

  test('an open relay waits for the grace window before it wins', () {
    final race = RouteRace(lanCandidates: 1);
    race.relayOpened();
    expect(race.choice, RouteChoice.wait);
    expect(race.awaitingGrace, isTrue);
    race.graceElapsed();
    expect(race.choice, RouteChoice.relay);
  });

  test('a LAN socket inside the window beats an open relay', () {
    final race = RouteRace(lanCandidates: 2);
    race.relayOpened();
    race.lanOpened(1);
    expect(race.choice, RouteChoice.lan);
    expect(race.lanIndex, 1);
    expect(race.awaitingGrace, isFalse);
  });

  test('a LAN socket after the window is ignored', () {
    final race = RouteRace(lanCandidates: 1);
    race.relayOpened();
    race.graceElapsed();
    race.lanOpened(0);
    expect(race.choice, RouteChoice.relay);
    expect(race.lanIndex, isNull);
  });

  test('the relay wins as soon as every LAN candidate has failed', () {
    final race = RouteRace(lanCandidates: 2);
    race.relayOpened();
    race.lanFailed();
    expect(race.choice, RouteChoice.wait);
    expect(
      race.awaitingGrace,
      isTrue,
      reason: 'one candidate is still dialling',
    );
    race.lanFailed();
    expect(race.choice, RouteChoice.relay);
    expect(race.awaitingGrace, isFalse);
  });

  test('a relay socket that dies during the window hands the race back', () {
    final race = RouteRace(lanCandidates: 1);
    race.relayOpened();
    race.relayFailed();
    expect(race.choice, RouteChoice.wait);
    expect(race.awaitingGrace, isFalse);
    race.lanOpened(0);
    expect(race.choice, RouteChoice.lan);
  });

  test('a LAN-only race stays unresolved until a socket opens', () {
    final race = RouteRace(lanCandidates: 1);
    race.graceElapsed();
    expect(race.choice, RouteChoice.wait);
    expect(race.awaitingGrace, isFalse);
    race.lanOpened(0);
    expect(race.choice, RouteChoice.lan);
  });
}
