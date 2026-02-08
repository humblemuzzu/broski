import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/tool.dart';
import '../models/vcs.dart';
import '../providers/connection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../providers/tool_settings_provider.dart';
import '../services/storage_service.dart';
import '../theme/opencode_theme.dart';

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
            _error = e.toString();
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
          icon: Icon(Icons.arrow_back_rounded, color: theme.text),
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
            icon: Icon(Icons.refresh_rounded, color: theme.text),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? Center(child: CircularProgressIndicator(color: theme.primary))
          : _error != null
          ? _buildError(theme)
          : _buildContent(theme),
    );
  }

  Widget _buildError(OpenCodeTheme theme) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.error_outline, size: 48, color: theme.textMuted),
          const SizedBox(height: 16),
          Text(
            'Failed to load tools',
            style: TextStyle(color: theme.text, fontSize: 16),
          ),
          const SizedBox(height: 8),
          Text(
            _error!,
            style: TextStyle(color: theme.textMuted, fontSize: 14),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
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
            Icon(Icons.build_outlined, size: 48, color: theme.textMuted),
            const SizedBox(height: 16),
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
        padding: const EdgeInsets.all(16),
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
            const SizedBox(height: 8),
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
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: theme.primary.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(Icons.build, color: theme.primary, size: 24),
          ),
          const SizedBox(width: 16),
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
                const SizedBox(height: 4),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: theme.success.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '$enabledCount enabled',
                        style: TextStyle(color: theme.success, fontSize: 12),
                      ),
                    ),
                    if (disabledCount > 0) ...[
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: theme.textMuted.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
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
                style: TextStyle(color: theme.primary, fontSize: 13),
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
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Tappable header
          InkWell(
            onTap: onToggle,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
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
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: theme.primary.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(6),
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
                      Icons.keyboard_arrow_down_rounded,
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
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(10),
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
                Icons.visibility_off_rounded,
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
        return Icons.terminal;
      case 'read':
        return Icons.file_open;
      case 'write':
        return Icons.edit_document;
      case 'edit':
        return Icons.edit;
      case 'glob':
        return Icons.folder_copy;
      case 'grep':
        return Icons.search;
      case 'webfetch':
        return Icons.language;
      case 'task':
        return Icons.account_tree;
      case 'todowrite':
      case 'todoread':
        return Icons.checklist;
      case 'skill':
        return Icons.school;
      default:
        return Icons.build;
    }
  }
}

/// Compact chip for formatter display
class _FormatterChip extends StatelessWidget {
  const _FormatterChip({required this.formatter});

  final FormatterInfo formatter;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final statusColor = switch (formatter.status) {
      FormatterStatus.active => theme.success,
      FormatterStatus.error => theme.error,
      FormatterStatus.inactive => theme.textMuted,
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: statusColor.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: statusColor.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(Icons.code_rounded, color: statusColor, size: 16),
          const SizedBox(width: 8),
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
                if (formatter.language != null)
                  Text(
                    formatter.language!,
                    style: TextStyle(color: theme.textMuted, fontSize: 11),
                  ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: statusColor.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              switch (formatter.status) {
                FormatterStatus.active => 'Active',
                FormatterStatus.error => 'Error',
                FormatterStatus.inactive => 'Off',
              },
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
