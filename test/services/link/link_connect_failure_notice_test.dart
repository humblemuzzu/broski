import 'package:broski/services/link/link_connect_failure_notice.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('names the failure without an exception prefix', () {
    expect(
      linkConnectFailureText(
        const FormatException('a pairing secret is 32 bytes'),
      ),
      "Couldn't open the link to your Mac · a pairing secret is 32 bytes",
    );
  });

  test('falls back to the plain sentence when there is no detail', () {
    expect(
      linkConnectFailureText(StateError('')),
      "Couldn't open the link to your Mac",
    );
  });
}
