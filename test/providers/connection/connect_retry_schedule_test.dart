import 'package:broski/providers/connection/connect_retry_schedule.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('doubles from the first delay and stops at the cap', () {
    final schedule = ConnectRetrySchedule(
      initial: const Duration(seconds: 1),
      max: const Duration(seconds: 8),
    );

    expect(
      [
        schedule.next(),
        schedule.next(),
        schedule.next(),
        schedule.next(),
        schedule.next(),
      ],
      const [
        Duration(seconds: 1),
        Duration(seconds: 2),
        Duration(seconds: 4),
        Duration(seconds: 8),
        Duration(seconds: 8),
      ],
    );
  });

  test('a successful connect resets the backoff', () {
    final schedule = ConnectRetrySchedule(
      initial: const Duration(seconds: 1),
      max: const Duration(seconds: 8),
    );
    schedule.next();
    schedule.next();
    schedule.reset();

    expect(schedule.next(), const Duration(seconds: 1));
  });
}
