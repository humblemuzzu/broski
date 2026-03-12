import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/codex/codex_plugin.dart';
import 'service_providers.dart';

/// Provider for listing Codex plugins from marketplace.
///
/// Parameterized by cwd (optional).
final codexPluginsProvider =
    FutureProvider.family<List<CodexPluginMarketplace>, String?>(
  (ref, cwd) async {
    final bridge = ref.watch(bridgeServiceProvider);
    return bridge.cxListPlugins(cwd: cwd);
  },
);
