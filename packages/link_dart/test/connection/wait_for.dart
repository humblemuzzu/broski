import 'package:test/test.dart';

/// Polls [condition] until it holds, or fails with [reason].
Future<void> waitFor(
  bool Function() condition, {
  String? reason,
  Duration timeout = const Duration(seconds: 3),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('timed out waiting for ${reason ?? 'a condition'}');
    }
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
}
