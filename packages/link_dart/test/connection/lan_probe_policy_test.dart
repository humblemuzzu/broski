import 'package:broski_link/src/connection/lan_probe_policy.dart';
import 'package:test/test.dart';

void main() {
  test('one probe at a time, the next one a full interval later', () {
    final policy = LanProbePolicy();
    expect(policy.dueAt, Duration.zero);
    expect(policy.start(const Duration(milliseconds: 100)), isTrue);
    expect(policy.dueAt, isNull, reason: 'in flight');
    expect(policy.start(const Duration(seconds: 30)), isFalse);
    policy.end(const Duration(milliseconds: 200));
    expect(policy.dueAt, const Duration(milliseconds: 15200));
    expect(policy.start(const Duration(seconds: 15)), isFalse);
    expect(policy.start(const Duration(milliseconds: 15200)), isTrue);
  });

  test('resume makes the next probe due at once and never later', () {
    final policy = LanProbePolicy()
      ..start(Duration.zero)
      ..end(Duration.zero);
    policy.resume(const Duration(seconds: 5));
    expect(policy.dueAt, const Duration(seconds: 5));
    policy.resume(const Duration(seconds: 9));
    expect(policy.dueAt, const Duration(seconds: 5));
  });
}
