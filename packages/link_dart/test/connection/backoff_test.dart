import 'package:broski_link/src/connection/backoff.dart';
import 'package:test/test.dart';

void main() {
  test('doubles from min to max and stays at max', () {
    final backoff = Backoff(random: () => 0.5);
    expect(
      <Duration>[for (var step = 0; step < 7; step++) backoff.nextDelay()],
      [
        const Duration(milliseconds: 500),
        const Duration(seconds: 1),
        const Duration(seconds: 2),
        const Duration(seconds: 4),
        const Duration(seconds: 8),
        const Duration(seconds: 10),
        const Duration(seconds: 10),
      ],
    );
  });

  test('jitters the delay it hands out by +-20%', () {
    expect(
      Backoff(random: () => 0).nextDelay(),
      const Duration(milliseconds: 400),
    );
    expect(
      Backoff(random: () => 1).nextDelay(),
      const Duration(milliseconds: 600),
    );
  });

  test('reset returns to the shortest delay', () {
    final backoff = Backoff(random: () => 0.5)
      ..nextDelay()
      ..nextDelay()
      ..reset();
    expect(backoff.nextDelay(), const Duration(milliseconds: 500));
  });
}
