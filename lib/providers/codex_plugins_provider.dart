import 'package:broski/models/codex/codex_plugin.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Provider for listing Codex plugins from marketplace.
///
/// Parameterized by cwd (optional).
final codexPluginsProvider =
    FutureProvider.family<List<CodexPluginMarketplace>, String?>((
      ref,
      cwd,
    ) async {
      final bridge = ref.watch(bridgeServiceProvider);
      return bridge.cxListPlugins(cwd: cwd);
    });
