import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/tool.dart';
import '../models/vcs.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../providers/tool_settings_provider.dart';

// Color constants matching chat screen design
const _kBackground = Color(0xFF16161E);
const _kCard = Color(0xFF1F2128);
const _kBorder = Color(0xFF2A2D36);
const _kOnBackground = Color(0xFFE4E4E7);
const _kMuted = Color(0xFF71717A);
const _kAccent = Color(0xFF3B82F6);
const _kSuccess = Color(0xFF10B981);

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

      if (mounted) {
        setState(() {
          _tools = tools;
          _formatters = formatters;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
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
    return Scaffold(
      backgroundColor: _kBackground,
      appBar: AppBar(
        backgroundColor: _kBackground,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: _kOnBackground),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          'Tools',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: _kOnBackground,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, color: _kOnBackground),
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: _kAccent))
          : _error != null
          ? _buildError()
          : _buildContent(),
    );
  }

  Widget _buildError() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.error_outline, size: 48, color: _kMuted),
          const SizedBox(height: 16),
          Text(
            'Failed to load tools',
            style: const TextStyle(color: _kOnBackground, fontSize: 16),
          ),
          const SizedBox(height: 8),
          Text(
            _error!,
            style: const TextStyle(color: _kMuted, fontSize: 14),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _loadData,
            style: ElevatedButton.styleFrom(
              backgroundColor: _kAccent,
              foregroundColor: Colors.white,
            ),
            child: const Text('Retry'),
          ),
        ],
      ),
    );
  }

  Widget _buildContent() {
    if (_tools == null || _tools!.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.build_outlined, size: 48, color: _kMuted),
            SizedBox(height: 16),
            Text(
              'No tools available',
              style: TextStyle(color: _kMuted, fontSize: 16),
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
      color: _kAccent,
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
    final statusColor = switch (formatter.status) {
      FormatterStatus.active => _kSuccess,
      FormatterStatus.error => const Color(0xFFEF4444),
      FormatterStatus.inactive => _kMuted,
    };

    final statusLabel = switch (formatter.status) {
      FormatterStatus.active => 'Active',
      FormatterStatus.error => 'Error',
      FormatterStatus.inactive => 'Inactive',
    };

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kBorder),
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
          style: const TextStyle(
            color: _kOnBackground,
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
                  style: const TextStyle(color: _kMuted, fontSize: 13),
                ),
                const SizedBox(width: 8),
              ],
              if (formatter.hasError && formatter.error != null)
                Expanded(
                  child: Text(
                    formatter.error!,
                    style: const TextStyle(
                      color: Color(0xFFEF4444),
                      fontSize: 12,
                    ),
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
    final toolSettings = ref.watch(toolSettingsProvider);
    final disabledCount = toolSettings.disabledTools.length;
    final enabledCount = totalTools - disabledCount;

    return Container(
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.only(bottom: 20),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: _kBorder),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: _kAccent.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(Icons.build, color: _kAccent, size: 24),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '$totalTools Tools Available',
                  style: const TextStyle(
                    color: _kOnBackground,
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
                        color: _kSuccess.withValues(alpha: 0.15),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '$enabledCount enabled',
                        style: const TextStyle(color: _kSuccess, fontSize: 12),
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
                          color: _kMuted.withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '$disabledCount disabled',
                          style: const TextStyle(color: _kMuted, fontSize: 12),
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
              child: const Text(
                'Enable All',
                style: TextStyle(color: _kAccent, fontSize: 13),
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
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title.toUpperCase(),
        style: const TextStyle(
          color: _kMuted,
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
    final toolSettings = ref.watch(toolSettingsProvider);
    final isEnabled = toolSettings.isToolEnabled(tool.id);
    final iconColor = isEnabled ? _kAccent : _kMuted;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      decoration: BoxDecoration(
        color: _kCard,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: _kBorder),
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
            color: isEnabled ? _kOnBackground : _kMuted,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            tool.description ?? '',
            style: const TextStyle(color: _kMuted, fontSize: 13),
          ),
        ),
        trailing: Switch.adaptive(
          value: isEnabled,
          onChanged: (_) {
            ref.read(toolSettingsProvider.notifier).toggleTool(tool.id);
          },
          activeThumbColor: _kSuccess,
          activeTrackColor: _kSuccess.withValues(alpha: 0.3),
          inactiveThumbColor: _kMuted,
          inactiveTrackColor: _kMuted.withValues(alpha: 0.3),
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
