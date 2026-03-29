import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows detailed information about a Codex plugin.
void showCxPluginDetailSheet({
  required BuildContext context,
  required String marketplacePath,
  required String pluginName,
}) {
  DetailSheet.show(
    context: context,
    title: pluginName,
    initialSize: 0.6,
    child: _CxPluginDetailContent(
      marketplacePath: marketplacePath,
      pluginName: pluginName,
    ),
  );
}

class _CxPluginDetailContent extends ConsumerStatefulWidget {
  const _CxPluginDetailContent({
    required this.marketplacePath,
    required this.pluginName,
  });
  final String marketplacePath;
  final String pluginName;

  @override
  ConsumerState<_CxPluginDetailContent> createState() =>
      _CxPluginDetailContentState();
}

class _CxPluginDetailContentState
    extends ConsumerState<_CxPluginDetailContent> {
  Map<String, dynamic>? _detail;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDetail();
  }

  Future<void> _loadDetail() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final result = await bridge.cxPluginRead(
        marketplacePath: widget.marketplacePath,
        pluginName: widget.pluginName,
      );
      if (mounted) {
        setState(() {
          _detail = result;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    if (_loading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'Error: $_error',
          style: AppTypography.bodySmall(color: theme.error),
        ),
      );
    }

    final detail = _detail ?? {};
    final description = detail['description'] as String? ?? '';
    final version = detail['version'] as String? ?? '';
    final author = detail['author'] as String? ?? '';
    final tools = detail['tools'] as List<dynamic>? ?? [];
    final permissions = detail['permissions'] as List<dynamic>? ?? [];
    final configSchema = detail['configSchema'] as Map<String, dynamic>?;

    return SingleChildScrollView(
      padding: Insets.screenH,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 12),
          // Version + Author
          if (version.isNotEmpty || author.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Wrap(
                spacing: 8,
                children: [
                  if (version.isNotEmpty)
                    _InfoChip(
                      icon: AppIcons.gitCommit,
                      label: 'v$version',
                      theme: theme,
                    ),
                  if (author.isNotEmpty)
                    _InfoChip(
                      icon: AppIcons.person,
                      label: author,
                      theme: theme,
                    ),
                ],
              ),
            ),
          // Description
          if (description.isNotEmpty) ...[
            Text(
              description,
              style: AppTypography.bodySmall(color: theme.text),
            ),
            const SizedBox(height: 16),
          ],
          // Tools
          if (tools.isNotEmpty) ...[
            Text(
              'Tools (${tools.length})',
              style: AppTypography.label(color: theme.textMuted),
            ),
            const SizedBox(height: 8),
            ...tools.map((tool) {
              final toolMap = tool is Map<String, dynamic>
                  ? tool
                  : <String, dynamic>{};
              final name = toolMap['name'] as String? ?? '';
              final desc = toolMap['description'] as String? ?? '';
              return Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: theme.bgRaised,
                    borderRadius: Radii.brSm,
                    border: Border.all(color: theme.border),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: AppTypography.labelSmall(color: theme.text),
                      ),
                      if (desc.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text(
                          desc,
                          style: AppTypography.codeSmall(
                            color: theme.textMuted,
                          ),
                          maxLines: 3,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ],
                  ),
                ),
              );
            }),
            const SizedBox(height: 16),
          ],
          // Permissions
          if (permissions.isNotEmpty) ...[
            Text(
              'Permissions',
              style: AppTypography.label(color: theme.textMuted),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: permissions.map((p) {
                return Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: theme.warning.withValues(alpha: 0.1),
                    borderRadius: Radii.brXs,
                    border: Border.all(
                      color: theme.warning.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Text(
                    p.toString(),
                    style: TextStyle(fontSize: 11, color: theme.warning),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 16),
          ],
          // Config schema summary
          if (configSchema != null) ...[
            Text(
              'Configuration',
              style: AppTypography.label(color: theme.textMuted),
            ),
            const SizedBox(height: 8),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.bgRaised,
                borderRadius: Radii.brSm,
              ),
              child: Text(
                'This plugin has configurable options',
                style: AppTypography.bodySmall(color: theme.textMuted),
              ),
            ),
          ],
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  const _InfoChip({
    required this.icon,
    required this.label,
    required this.theme,
  });
  final IconData icon;
  final String label;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: theme.bgRaised,
        borderRadius: Radii.brXs,
        border: Border.all(color: theme.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: theme.textMuted),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, color: theme.textMuted)),
        ],
      ),
    );
  }
}
