import 'dart:async';

import 'package:broski/providers/codex/cx_rate_limits_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Sets up a periodic background sync timer for Codex sessions.
///
/// Every 30 seconds it refreshes:
/// - Rate limits (so the UI badge stays current between turns)
/// - Session context / token usage (via the provided callback)
///
/// Returns the timer — caller must cancel it in `dispose()`.
///
/// Extracted from chat_screen.dart per modular architecture rules.
Timer? setupCxBackgroundSyncTimer({
  required WidgetRef ref,
  required bool isCodex,
  required void Function() onRefreshContext,
}) {
  if (!isCodex) return null;
  return Timer.periodic(const Duration(seconds: 30), (_) {
    // Refresh rate limits (best-effort, ignore failures).
    final bridge = ref.read(bridgeServiceProvider);
    bridge
        .cxRateLimitsRead()
        .then((data) {
          if (data.isNotEmpty) {
            ref.read(cxLiveRateLimitsProvider.notifier).state = data;
          }
        })
        .catchError((_) {});
    // Refresh session context (token usage, etc.)
    onRefreshContext();
  });
}
