import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../theme/app_icons.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../providers/service_providers.dart';
import '../../providers/chat_provider.dart';
import '../../utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Shows the external agent config import sheet.
void showCxImportConfigSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'Import Agent Config',
    initialSize: 0.5,
    child: const _CxImportConfigContent(),
  );
}

final _cxExternalConfigsProvider = FutureProvider<List<Map<String, dynamic>>>((
  ref,
) async {
  final bridge = ref.watch(bridgeServiceProvider);
  final cwd = ref.watch(chatSessionProvider).cxCwd;
  return bridge.cxDetectExternalConfigs(cwds: cwd != null ? [cwd] : null);
});

class _CxImportConfigContent extends ConsumerStatefulWidget {
  const _CxImportConfigContent();

  @override
  ConsumerState<_CxImportConfigContent> createState() =>
      _CxImportConfigContentState();
}

class _CxImportConfigContentState
    extends ConsumerState<_CxImportConfigContent> {
  String? _importingSource;

  Future<void> _import(String source, {String? configPath}) async {
    setState(() => _importingSource = source);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.cxImportExternalConfig(
        source: source,
        configPath: configPath,
      );
      if (mounted) {
        showInfo(context, 'Imported config from $source');
      }
    } catch (e) {
      if (mounted) {
        showInfo(context, 'Import failed: ${humanizeError(e)}');
      }
    } finally {
      if (mounted) setState(() => _importingSource = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final configsAsync = ref.watch(_cxExternalConfigsProvider);

    return configsAsync.when(
      data: (configs) {
        if (configs.isEmpty) {
          return Padding(
            padding: Insets.card,
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(AppIcons.search, size: 32, color: theme.textMuted),
                  SizedBox(height: Spacing.sm),
                  Text(
                    'No external agent configs detected.',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                  SizedBox(height: Spacing.xs),
                  Text(
                    'Checks for Claude Code, Cursor, Windsurf, and other agent configs.',
                    style: AppTypography.label(color: theme.textMuted),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          );
        }
        return Padding(
          padding: Insets.screenH,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Detected configurations that can be imported into Codex:',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
              SizedBox(height: Spacing.md),
              ...configs.map((cfg) {
                final source =
                    cfg['source']?.toString() ??
                    cfg['name']?.toString() ??
                    'Unknown';
                final path =
                    cfg['path']?.toString() ??
                    cfg['configPath']?.toString() ??
                    '';
                final description = cfg['description']?.toString() ?? '';
                final configTypes = cfg['configTypes'] as List<dynamic>? ?? [];
                final isImporting = _importingSource == source;
                return Container(
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.bgRaised,
                    borderRadius: Radii.brSm,
                    border: Border.all(color: theme.border),
                  ),
                  child: Row(
                    children: [
                      Icon(AppIcons.settings, size: 20, color: theme.primary),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              source,
                              style: AppTypography.labelLarge(
                                color: theme.text,
                              ),
                            ),
                            if (path.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Text(
                                path,
                                style: AppTypography.label(
                                  color: theme.textMuted,
                                ),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                            if (description.isNotEmpty) ...[
                              const SizedBox(height: 2),
                              Text(
                                description,
                                style: AppTypography.label(
                                  color: theme.textMuted,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                            if (configTypes.isNotEmpty) ...[
                              const SizedBox(height: 4),
                              Wrap(
                                spacing: 4,
                                children: configTypes.map((t) {
                                  return Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                      vertical: 1,
                                    ),
                                    decoration: BoxDecoration(
                                      color: theme.primary.withValues(
                                        alpha: 0.1,
                                      ),
                                      borderRadius: Radii.brXs,
                                    ),
                                    child: Text(
                                      t.toString(),
                                      style: TextStyle(
                                        color: theme.primary,
                                        fontSize: 10,
                                        fontWeight: FontWeight.w500,
                                      ),
                                    ),
                                  );
                                }).toList(),
                              ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      isImporting
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : IconButton(
                              icon: Icon(
                                AppIcons.download,
                                size: 18,
                                color: theme.primary,
                              ),
                              onPressed: () =>
                                  _import(source, configPath: path),
                              tooltip: 'Import',
                              padding: EdgeInsets.zero,
                              constraints: const BoxConstraints(
                                minWidth: 32,
                                minHeight: 32,
                              ),
                            ),
                    ],
                  ),
                );
              }),
              SizedBox(height: Spacing.sm),
              Text(
                'Importing merges configs — nothing is deleted.',
                style: AppTypography.label(color: theme.textMuted),
              ),
            ],
          ),
        );
      },
      loading: () => const Padding(
        padding: Insets.xxxl,
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (e, _) => Padding(
        padding: Insets.card,
        child: Center(
          child: Text(
            'Failed to detect configs: ${humanizeError(e)}',
            style: AppTypography.bodySmall(color: theme.error),
          ),
        ),
      ),
    );
  }
}
