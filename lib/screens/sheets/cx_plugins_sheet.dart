import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/codex/codex_plugin.dart';
import '../../providers/codex_plugins_provider.dart';
import '../../providers/chat_provider.dart';
import '../../providers/service_providers.dart';
import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/error_utils.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../widgets/chat/section_header.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Shows the Codex Plugins marketplace sheet. Extracted as top-level function.
void showCxPluginsSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'Plugins',
    initialSize: 0.55,
    child: const CxPluginsSheet(),
  );
}

/// Bottom sheet listing installed and available Codex plugins by marketplace.
class CxPluginsSheet extends ConsumerStatefulWidget {
  const CxPluginsSheet({super.key});

  @override
  ConsumerState<CxPluginsSheet> createState() => _CxPluginsSheetState();
}

class _CxPluginsSheetState extends ConsumerState<CxPluginsSheet> {
  /// Tracks which plugins are currently being installed/uninstalled.
  final Set<String> _actionInProgress = {};

  String? _cwd(WidgetRef ref) {
    final session = ref.watch(chatSessionProvider);
    return session.cxCwd ?? session.projectPath;
  }

  Future<void> _installPlugin(
    CodexPlugin plugin,
    String marketplacePath,
  ) async {
    final key = '$marketplacePath:${plugin.name}';
    setState(() => _actionInProgress.add(key));
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.cxInstallPlugin(
        marketplacePath: marketplacePath,
        pluginName: plugin.name,
      );
      // Refresh the provider to reflect the change.
      ref.invalidate(codexPluginsProvider);
    } catch (e) {
      if (mounted) {
        showInfo(context, 'Install failed: ${humanizeError(e)}');
      }
    } finally {
      if (mounted) setState(() => _actionInProgress.remove(key));
    }
  }

  Future<void> _uninstallPlugin(CodexPlugin plugin) async {
    final key = plugin.id;
    setState(() => _actionInProgress.add(key));
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.cxUninstallPlugin(pluginId: plugin.id);
      ref.invalidate(codexPluginsProvider);
    } catch (e) {
      if (mounted) {
        showInfo(context, 'Uninstall failed: ${humanizeError(e)}');
      }
    } finally {
      if (mounted) setState(() => _actionInProgress.remove(key));
    }
  }

  @override
  Widget build(BuildContext context) {
    final cwd = _cwd(ref);
    final pluginsAsync = ref.watch(codexPluginsProvider(cwd));
    final ocTheme = OpenCodeTheme.of(context);

    return pluginsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Error: ${humanizeError(e)}',
              style: TextStyle(color: ocTheme.error),
            ),
            SizedBox(height: Spacing.md),
            TextButton(
              onPressed: () => ref.invalidate(codexPluginsProvider),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
      data: (marketplaces) {
        if (marketplaces.isEmpty) {
          return Center(
            child: Padding(
              padding: Insets.screenV,
              child: Text(
                'No plugin marketplaces available.',
                style: AppTypography.bodySmall(color: ocTheme.textMuted),
              ),
            ),
          );
        }

        // Split plugins across all marketplaces into installed vs available.
        final installed = <_PluginEntry>[];
        final available = <_PluginEntry>[];
        for (final marketplace in marketplaces) {
          for (final plugin in marketplace.plugins) {
            final entry = _PluginEntry(
              plugin: plugin,
              marketplaceName: marketplace.name,
              marketplacePath: marketplace.path,
            );
            if (plugin.installed) {
              installed.add(entry);
            } else {
              available.add(entry);
            }
          }
        }

        return Padding(
          padding: Insets.screenH,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (installed.isNotEmpty) ...[
                Padding(
                  padding: Insets.bottomSm,
                  child: SectionHeader(title: 'INSTALLED', theme: ocTheme),
                ),
                SizedBox(height: Spacing.xs),
                ...installed.map(
                  (e) => _PluginTile(
                    entry: e,
                    theme: ocTheme,
                    isLoading:
                        _actionInProgress.contains(e.plugin.id) ||
                        _actionInProgress.contains(
                          '${e.marketplacePath}:${e.plugin.name}',
                        ),
                    onAction: () => _uninstallPlugin(e.plugin),
                    isInstalled: true,
                  ),
                ),
                SizedBox(height: Spacing.lg),
              ],
              if (available.isNotEmpty) ...[
                Padding(
                  padding: Insets.bottomSm,
                  child: SectionHeader(title: 'AVAILABLE', theme: ocTheme),
                ),
                SizedBox(height: Spacing.xs),
                ...available.map(
                  (e) => _PluginTile(
                    entry: e,
                    theme: ocTheme,
                    isLoading: _actionInProgress.contains(
                      '${e.marketplacePath}:${e.plugin.name}',
                    ),
                    onAction: () => _installPlugin(e.plugin, e.marketplacePath),
                    isInstalled: false,
                  ),
                ),
              ],
              if (installed.isEmpty && available.isEmpty)
                Padding(
                  padding: Insets.screenV,
                  child: Text(
                    'No plugins found.',
                    style: AppTypography.bodySmall(color: ocTheme.textMuted),
                  ),
                ),
              SizedBox(height: Spacing.lg),
            ],
          ),
        );
      },
    );
  }
}

// ── Private helpers ─────────────────────────────────────────────────────────

/// Groups a plugin with its marketplace context for display.
class _PluginEntry {
  final CodexPlugin plugin;
  final String marketplaceName;
  final String marketplacePath;

  const _PluginEntry({
    required this.plugin,
    required this.marketplaceName,
    required this.marketplacePath,
  });
}

/// Single plugin row with install/remove action button.
class _PluginTile extends StatelessWidget {
  final _PluginEntry entry;
  final OpenCodeTheme theme;
  final bool isLoading;
  final VoidCallback onAction;
  final bool isInstalled;

  const _PluginTile({
    required this.entry,
    required this.theme,
    required this.isLoading,
    required this.onAction,
    required this.isInstalled,
  });

  @override
  Widget build(BuildContext context) {
    final plugin = entry.plugin;
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      leading: Icon(
        AppIcons.plugin,
        size: 20,
        color: plugin.enabled ? theme.primary : theme.textMuted,
      ),
      title: Text(
        plugin.name,
        style: TextStyle(
          color: theme.text,
          fontSize: 13,
          fontWeight: FontWeight.w600,
        ),
      ),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (entry.marketplaceName.isNotEmpty)
            Text(
              'Source: ${entry.marketplaceName}',
              style: AppTypography.caption(color: theme.textMuted),
            ),
          if (isInstalled && plugin.enabled)
            Text('Enabled', style: AppTypography.caption(color: theme.success)),
          if (isInstalled && !plugin.enabled)
            Text(
              'Disabled',
              style: AppTypography.caption(color: theme.textMuted),
            ),
        ],
      ),
      trailing: isLoading
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : isInstalled
          ? TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                foregroundColor: theme.error,
                padding: Insets.chipH,
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(
                'Remove',
                style: AppTypography.label(color: theme.error),
              ),
            )
          : TextButton(
              onPressed: onAction,
              style: TextButton.styleFrom(
                foregroundColor: theme.primary,
                padding: Insets.chipH,
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              child: Text(
                'Install',
                style: AppTypography.label(color: theme.primary),
              ),
            ),
    );
  }
}
