import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Live rate limit data from Codex `account/rateLimits/updated` push notifications.
/// Updated reactively by `CodexThreadsNotifier._handleBridgeMessage`.
final cxLiveRateLimitsProvider = StateProvider<Map<String, dynamic>?>(
  (ref) => null,
);
