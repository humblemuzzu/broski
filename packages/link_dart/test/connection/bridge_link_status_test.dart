import 'package:broski_link/broski_link.dart';
import 'package:test/test.dart';

void main() {
  test('a full bridge status parses', () {
    final status = BridgeLinkStatus.tryParse(const <String, Object?>{
      't': 'bridge',
      'state': 'up',
      'conn': 7,
      'detail': null,
    });

    expect(status?.state, BridgeStatusState.up);
    expect(status?.conn, 7);
    expect(status?.detail, isNull);
  });

  test('every state the daemon sends has a value', () {
    for (final (raw, expected) in const <(String, BridgeStatusState)>[
      ('up', BridgeStatusState.up),
      ('connecting', BridgeStatusState.connecting),
      ('starting', BridgeStatusState.starting),
      ('down', BridgeStatusState.down),
      ('crashed', BridgeStatusState.crashed),
    ]) {
      expect(
        BridgeLinkStatus.tryParse(<String, Object?>{
          't': 'bridge',
          'state': raw,
          'conn': 1,
        })?.state,
        expected,
        reason: raw,
      );
    }
  });

  test('a state this build does not know is kept, as unknown', () {
    final status = BridgeLinkStatus.tryParse(const <String, Object?>{
      't': 'bridge',
      'state': 'restarting',
      'conn': 2,
    });

    expect(status?.state, BridgeStatusState.unknown);
  });

  test('a missing or unusable conn is refused rather than defaulted', () {
    for (final message in const <Map<String, Object?>>[
      <String, Object?>{'t': 'bridge', 'state': 'up'},
      <String, Object?>{'t': 'bridge', 'state': 'up', 'conn': null},
      <String, Object?>{'t': 'bridge', 'state': 'up', 'conn': '3'},
      <String, Object?>{'t': 'bridge', 'state': 'up', 'conn': 1.5},
      <String, Object?>{'t': 'bridge', 'state': 'up', 'conn': -1},
    ]) {
      expect(BridgeLinkStatus.tryParse(message), isNull, reason: '$message');
    }
  });

  test('a missing state is refused', () {
    expect(
      BridgeLinkStatus.tryParse(const <String, Object?>{
        't': 'bridge',
        'conn': 1,
      }),
      isNull,
    );
  });

  test('other control messages are not bridge statuses', () {
    expect(
      BridgeLinkStatus.tryParse(const <String, Object?>{
        't': 'routes',
        'relay': 'wss://relay',
        'conn': 1,
      }),
      isNull,
    );
  });

  test('a non-string detail is dropped, not carried', () {
    final status = BridgeLinkStatus.tryParse(const <String, Object?>{
      't': 'bridge',
      'state': 'crashed',
      'conn': 4,
      'detail': <String, Object?>{'why': 'exit 1'},
    });

    expect(status?.detail, isNull);
    expect(status?.state, BridgeStatusState.crashed);
  });
}
