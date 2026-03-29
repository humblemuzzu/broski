import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Cached config requirements from Codex.
/// Maps config key paths to their validation rules.
final cxConfigRequirementsProvider = FutureProvider<Map<String, dynamic>>((
  ref,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  try {
    return await bridge.cxConfigRequirementsRead();
  } catch (_) {
    return const {};
  }
});
