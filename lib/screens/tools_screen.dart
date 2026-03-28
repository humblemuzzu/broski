import 'package:broski/models/tool.dart';
import 'package:broski/models/vcs.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/tool_settings_provider.dart';
import 'package:broski/services/storage_service.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Feature 17: Tool List Screen
/// Shows available AI tools (bash, read, write, edit, glob, grep, etc.)
class ToolsScreen extends ConsumerStatefulWidget {
  const ToolsScreen({super.key});
  @override
  ConsumerState<ToolsScreen> createState() => _ToolsScreenState();
}

class _ToolsScreenState extends ConsumerState<ToolsScreen> {
  List<ToolInfo>? _tools;
  List<FormatterInfo>? _formatters;
  bool _isLoading = true;
  String? _error;
  // Track expanded sections
  final Set<String> _expandedSections = {};
  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    final storage = StorageService();
    final connection = ref.read(connectionProvider);
    // If offline, use cached data
    if (connection.isOfflineMode) {
      final cachedTools = await storage.getCachedTools();
      if (mounted) {
        setState(() {
          _tools = cachedTools.isNotEmpty ? cachedTools : null;
          _formatters = []; // Formatters not cached (runtime state)
          _isLoading = false;
          if (cachedTools.isEmpty) {
            _error = 'No cached tools available offline';
          }
        });
      }
      return;
    }
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      // Get tool IDs first (always available)
      final toolIds = await bridge.listToolIds(
        projectPath: selection.project?.path,
      );
      // Prefer model-specific tool schemas (better descriptions + inputs).
      var selectedModel = selection.model;
      if (selectedModel == null) {
        final config = await bridge.getConfig();
        final modelString = config['model'] as String?;
        if (modelString != null && modelString.isNotEmpty) {
          final parsed = SelectedModel.fromString(modelString);
          ref.read(selectionProvider.notifier).selectModel(parsed);
          selectedModel = parsed;
        }
      }
      List<ToolInfo> tools;
      if (selectedModel != null) {
        final detailed = await bridge.listTools(
          provider: selectedModel.providerID,
          model: selectedModel.modelID,
          projectPath: selection.project?.path,
        );
        tools = detailed.isNotEmpty
            ? detailed
            : toolIds
                  .map(
                    (id) => ToolInfo(
                      id: id,
                      description: _getToolDescription(id),
                      parameters: const {},
                    ),
                  )
                  .toList();
      } else {
        tools = toolIds
            .map(
              (id) => ToolInfo(
                id: id,
                description: _getToolDescription(id),
                parameters: const {},
              ),
            )
            .toList();
      }
      // Feature 19: Load formatter status
      final formatters = await bridge.getFormatterStatus(
        projectPath: selection.project?.path,
      );
      // Cache for offline use
      if (tools.isNotEmpty) {
        await storage.cacheTools(tools);
      }
      if (mounted) {
        setState(() {
          _tools = tools;
          _formatters = formatters;
          _isLoading = false;
        });
      }
    } catch (e) {
      // On error, try to use cached data
      final cachedTools = await storage.getCachedTools();
      if (mounted) {
        if (cachedTools.isNotEmpty) {
          setState(() {
            _tools = cachedTools;
            _formatters = [];
            _isLoading = false;
          });
        } else {
          setState(() {
            _error = humanizeError(e);
            _isLoading = false;
          });
        }
      }
    }
  }

  String _getToolDescription(String id) {
    switch (id.toLowerCase()) {
      case 'bash':
        return 'Execute shell commands';
      case 'read':
        return 'Read file contents';
      case 'write':
        return 'Create or overwrite files';
      case 'edit':
        return 'Make targeted edits to files';
      case 'glob':
        return 'Find files by pattern';
      case 'grep':
        return 'Search file contents';
      case 'webfetch':
        return 'Fetch web page content';
      case 'task':
        return 'Delegate to sub-agents';
      case 'todowrite':
        return 'Update task list';
      case 'todoread':
        return 'Read task list';
      case 'skill':
        return 'Load specialized skills';
      default:
        return 'AI tool';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.background,
        elevation: 0,
        leading: IconButton(
          icon: Icon(AppIcons.back, color: theme.text),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Tools',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: theme.text,
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(AppIcons.refresh, color: theme.text),
            onPressed: _loadData,
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: _isLoading
            ? Center(child: CircularProgressIndicator(color: theme.primary))
            : _error != null
            ? _buildError(theme)
            : _buildContent(theme),
      ),
    );
  }

  Widget _buildError(OpenCodeTheme theme) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(AppIcons.error, size: 48, color: theme.textMuted),
          const SizedBox(height: Spacing.lg),
          Text(
            'Failed to load tools',
            style: TextStyle(color: theme.text, fontSize: 16),
          ),
          const SizedBox(height: Spacing.sm),
          Text(
            _error!,
            style: AppTypography.labelLarge(color: theme.textMuted),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Spacing.xxl),
          ElevatedButton(
            onPressed: _loadData,
            style: ElevatedButton.styleFrom(
              backgroundColor: theme.primary,
              foregroundColor: theme.selectedListItemText,
            ),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _buildContent(OpenCodeTheme theme) {
    if (_tools == null || _tools!.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(AppIcons.build, size: 48, color: theme.textMuted),
            const SizedBox(height: Spacing.lg),
            Text(
              'No tools available',
              style: TextStyle(color: theme.textMuted, fontSize: 16),
            ),
          ],
        ),
      );
    }
    // Group tools by category
    final groupedTools = <String, List<ToolInfo>>{};
    for (final tool in _tools!) {
      final category = tool.category;
      groupedTools.putIfAbsent(category, () => []).add(tool);
    }
    final categories = groupedTools.keys.toList()..sort();
    return RefreshIndicator(
      onRefresh: _loadData,
      color: theme.primary,
      child: ListView(
        padding: Insets.card,
        children: [
          // Summary
          _ToolsSummary(totalTools: _tools!.length),
          // Tool categories as collapsible sections
          ...categories.map((category) {
            final tools = groupedTools[category]!;
            final isExpanded = _expandedSections.contains(category);
            return _CollapsibleSection(
              title: category,
              itemCount: tools.length,
              isExpanded: isExpanded,
              onToggle: () {
                setState(() {
                  if (isExpanded) {
                    _expandedSections.remove(category);
                  } else {
                    _expandedSections.add(category);
                  }
                });
              },
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: tools.map((tool) => _ToolChip(tool: tool)).toList(),
              ),
            );
          }),
          // Feature 19: Formatters section as collapsible
          if (_formatters != null && _formatters!.isNotEmpty) ...[
            const SizedBox(height: Spacing.sm),
            _CollapsibleSection(
              title: 'Formatters',
              itemCount: _formatters!.length,
              isExpanded: _expandedSections.contains('Formatters'),
              onToggle: () {
                setState(() {
                  if (_expandedSections.contains('Formatters')) {
                    _expandedSections.remove('Formatters');
                  } else {
                    _expandedSections.add('Formatters');
                  }
                });
              },
              child: Column(
                children: _formatters!
                    .map((formatter) => _FormatterChip(formatter: formatter))
                    .toList(),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// Tools summary card with enable/disable count
class _ToolsSummary extends ConsumerWidget {
  const _ToolsSummary({required this.totalTools});
  final int totalTools;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final toolSettings = ref.watch(toolSettingsProvider);
    final disabledCount = toolSettings.disabledTools.length;
    final enabledCount = totalTools - disabledCount;
    return Container(
      padding: Insets.card,
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: theme.primary.withValues(alpha: 0.15),
              borderRadius: Radii.brMd,
            ),
            child: Icon(AppIcons.build, color: theme.primary, size: 24),
          ),
          const SizedBox(width: Spacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$totalTools Tools Available',
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Spacing.xs),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: theme.success.withValues(alpha: 0.15),
                        borderRadius: Radii.brSm,
                      ),
                      child: Text(
                        '$enabledCount enabled',
                        style: AppTypography.label(color: theme.success),
                      ),
                    ),
                    if (disabledCount > 0) ...[
                      const SizedBox(width: Spacing.sm),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: theme.textMuted.withValues(alpha: 0.15),
                          borderRadius: Radii.brSm,
                        ),
                        child: Text(
                          '$disabledCount disabled',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
          if (disabledCount > 0)
            TextButton(
              onPressed: () {
                ref.read(toolSettingsProvider.notifier).enableAllTools();
              },
              child: Text(
                'Enable All',
                style: AppTypography.bodySmall(color: theme.primary),
              ),
            ),
        ],
      ),
    );
  }
}

/// Collapsible section with expand/collapse arrow
class _CollapsibleSection extends StatelessWidget {
  const _CollapsibleSection({
    required this.title,
    required this.itemCount,
    required this.isExpanded,
    required this.onToggle,
    required this.child,
  });
  final String title;
  final int itemCount;
  final bool isExpanded;
  final VoidCallback onToggle;
  final Widget child;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: Insets.bottomMd,
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Tappable header
          InkWell(
            onTap: onToggle,
            borderRadius: Radii.sheetTop,
            child: Padding(
              padding: Insets.input,
              child: Row(
                children: [
                  Expanded(
                    child: Row(
                      children: [
                        Text(
                          title.toUpperCase(),
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.5,
                          ),
                        ),
                        const SizedBox(width: Spacing.sm),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: theme.primary.withValues(alpha: 0.15),
                            borderRadius: Radii.brSm,
                          ),
                          child: Text(
                            '$itemCount',
                            style: TextStyle(
                              color: theme.primary,
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  AnimatedRotation(
                    turns: isExpanded ? 0.5 : 0,
                    duration: const Duration(milliseconds: 200),
                    child: Icon(
                      AppIcons.chevronDown,
                      color: theme.textMuted,
                      size: 20,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Content (only when expanded)
          AnimatedCrossFade(
            firstChild: const SizedBox.shrink(),
            secondChild: Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
              child: child,
            ),
            crossFadeState: isExpanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            duration: const Duration(milliseconds: 200),
          ),
        ],
      ),
    );
  }
}

/// Compact chip for tool display - just icon + name, tap to toggle
class _ToolChip extends ConsumerWidget {
  const _ToolChip({required this.tool});
  final ToolInfo tool;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final toolSettings = ref.watch(toolSettingsProvider);
    final isEnabled = toolSettings.isToolEnabled(tool.id);
    final iconColor = isEnabled ? theme.primary : theme.textMuted;
    final bgColor = isEnabled
        ? theme.primary.withValues(alpha: 0.12)
        : theme.textMuted.withValues(alpha: 0.08);
    final borderColor = isEnabled
        ? theme.primary.withValues(alpha: 0.3)
        : theme.borderSubtle;
    return InkWell(
      onTap: () {
        ref.read(toolSettingsProvider.notifier).toggleTool(tool.id);
      },
      borderRadius: Radii.brMd,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: Radii.brMd,
          border: Border.all(color: borderColor),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(_getToolIcon(tool.id), color: iconColor, size: 16),
            const SizedBox(width: 6),
            Text(
              tool.displayName,
              style: TextStyle(
                color: isEnabled ? theme.text : theme.textMuted,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            if (!isEnabled) ...[
              const SizedBox(width: 6),
              Icon(
                AppIcons.visibilityOff,
                color: theme.textMuted.withValues(alpha: 0.5),
                size: 14,
              ),
            ],
          ],
        ),
      ),
    );
  }

  IconData _getToolIcon(String id) {
    switch (id.toLowerCase()) {
      case 'bash':
        return AppIcons.terminal;
      case 'read':
        return AppIcons.fileText;
      case 'write':
        return AppIcons.edit;
      case 'edit':
        return AppIcons.edit;
      case 'glob':
        return AppIcons.folderOff;
      case 'grep':
        return AppIcons.search;
      case 'webfetch':
        return AppIcons.globe;
      case 'task':
        return AppIcons.gitBranch;
      case 'todowrite':
      case 'todoread':
        return AppIcons.checklist;
      case 'skill':
        return AppIcons.school;
      default:
        return AppIcons.build;
    }
  }
}

/// Compact chip for formatter display (SDK shape: name/extensions/enabled)
class _FormatterChip extends StatelessWidget {
  const _FormatterChip({required this.formatter});
  final FormatterInfo formatter;
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final statusColor = formatter.enabled ? theme.success : theme.textMuted;
    return Container(
      margin: Insets.bottomSm,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: statusColor.withValues(alpha: 0.08),
        borderRadius: Radii.brMd,
        border: Border.all(color: statusColor.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(AppIcons.code, color: statusColor, size: 16),
          const SizedBox(width: Spacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  formatter.name,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (formatter.extensions.isNotEmpty)
                  Text(
                    formatter.extensionDisplay,
                    style: AppTypography.caption(color: theme.textMuted),
                  ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: statusColor.withValues(alpha: 0.15),
              borderRadius: Radii.brSm,
            ),
            child: Text(
              formatter.enabled ? 'Enabled' : 'Disabled',
              style: TextStyle(
                color: statusColor,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
