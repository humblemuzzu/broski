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
                      name: id,
                      description: _getToolDescription(id),
                      enabled: true,
                    ),
                  )
                  .toList();
      } else {
        tools = toolIds
            .map(
              (id) => ToolInfo(
                id: id,
                name: id,
                description: _getToolDescription(id),
                enabled: true,
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
              foregroundColor: Colors.white,
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

          // Tool categories
          ...categories.map((category) {
            final tools = groupedTools[category]!;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _SectionHeader(title: category),
                ...tools.map((tool) => _ToolCard(tool: tool)),
                const SizedBox(height: 16),
              ],
            );
          }),

          // Feature 19: Formatters section
          if (_formatters != null && _formatters!.isNotEmpty) ...[
            const SizedBox(height: 8),
            const _SectionHeader(title: 'Formatters'),
            ..._formatters!.map(
              (formatter) => _FormatterCard(formatter: formatter),
            ),
          ],
        ],
      ),
    );
  }
}

// Feature 19: Formatter card
class _FormatterCard extends StatelessWidget {
  const _FormatterCard({required this.formatter});

  final FormatterInfo formatter;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final statusColor = switch (formatter.status) {
      FormatterStatus.active => theme.success,
      FormatterStatus.error => theme.error,
      FormatterStatus.inactive => theme.textMuted,
    };

    final statusLabel = switch (formatter.status) {
      FormatterStatus.active => 'Active',
      FormatterStatus.error => 'Error',
      FormatterStatus.inactive => 'Inactive',
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: statusColor.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(Icons.code, color: statusColor, size: 22),
        ),
        title: Text(
          formatter.name,
          style: TextStyle(
            color: theme.text,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Row(
            children: [
              if (formatter.language != null) ...[
                Text(
                  formatter.language!,
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
                ),
                const SizedBox(width: 8),
              ],
              if (formatter.hasError && formatter.error != null)
                Expanded(
                  child: Text(
                    formatter.error!,
                    style: TextStyle(color: theme.error, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
          ),
        ),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
          decoration: BoxDecoration(
            color: statusColor.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Text(
            statusLabel,
            style: TextStyle(
              color: statusColor,
              fontSize: 11,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
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

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          color: theme.textMuted,
          fontSize: 12,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.5,
        ),
      ),
    );
  }
}

class _ToolCard extends ConsumerWidget {
  const _ToolCard({required this.tool});

  final ToolInfo tool;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final toolSettings = ref.watch(toolSettingsProvider);
    final isEnabled = toolSettings.isToolEnabled(tool.id);
    final iconColor = isEnabled ? theme.primary : theme.textMuted;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderSubtle),
      ),
      child: ListTile(
        onTap: () {
          ref.read(toolSettingsProvider.notifier).toggleTool(tool.id);
        },
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: Container(
          width: 44,
          height: 44,
          decoration: BoxDecoration(
            color: iconColor.withValues(alpha: 0.15),
            borderRadius: BorderRadius.circular(10),
          ),
          child: Icon(_getToolIcon(tool.id), color: iconColor, size: 22),
        ),
        title: Text(
          tool.displayName,
          style: TextStyle(
            color: isEnabled ? theme.text : theme.textMuted,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            tool.description ?? '',
            style: TextStyle(color: theme.textMuted, fontSize: 13),
          ),
        ),
        trailing: Switch.adaptive(
          value: isEnabled,
          onChanged: (_) {
            ref.read(toolSettingsProvider.notifier).toggleTool(tool.id);
          },
          activeThumbColor: theme.success,
          activeTrackColor: theme.success.withValues(alpha: 0.3),
          inactiveThumbColor: theme.textMuted,
          inactiveTrackColor: theme.textMuted.withValues(alpha: 0.3),
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
