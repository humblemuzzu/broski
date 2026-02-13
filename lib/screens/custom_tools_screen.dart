
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../providers/claude_code_provider.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import 'custom_tool_editor_screen.dart';
import '../widgets/claude_code_help.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
class CustomToolsScreen extends ConsumerStatefulWidget {
  const CustomToolsScreen({super.key});
  @override
  ConsumerState<CustomToolsScreen> createState() => _CustomToolsScreenState();
}
class _CustomToolsScreenState extends ConsumerState<CustomToolsScreen> {
  @override
  void initState() {
    super.initState();
    // Load custom tools when screen opens
    Future.microtask(() {
      ref.read(ccCustomToolsProvider.notifier).load();
    });
  }
  @override
  Widget build(BuildContext context) {
    final toolsAsync = ref.watch(ccCustomToolsProvider);
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      appBar: AppBar(
        backgroundColor: theme.colorScheme.surface,
        title: const Text('Custom Tools'),
        actions: [
          IconButton(
            icon: const Icon(AppIcons.help),
            onPressed: () => showClaudeCodeHelpSheet(
              context,
              topic: ClaudeCodeHelpTopic.customTools,
            ),
            tooltip: 'Help',
          ),
          IconButton(
            icon: const Icon(AppIcons.refresh),
            onPressed: () => ref.read(ccCustomToolsProvider.notifier).refresh(),
            tooltip: 'Refresh',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _createNewTool(context),
        child: const Icon(AppIcons.add),
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: toolsAsync.when(
        data: (tools) => tools.isEmpty
            ? _EmptyState(onCreateTool: () => _createNewTool(context))
            : _ToolsList(
                tools: tools,
                onEditTool: (tool) => _editTool(context, tool),
                onToggleTool: (tool, enabled) => _toggleTool(tool, enabled),
                onDeleteTool: (tool) => _confirmDeleteTool(context, tool),
              ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _ErrorState(
          error: error.toString(),
          onRetry: () => ref.read(ccCustomToolsProvider.notifier).load(),
        ),
      ),
      ),
    );
  }
  void _createNewTool(BuildContext context) {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => const CustomToolEditorScreen()),
    );
  }
  void _editTool(BuildContext context, ClaudeCodeCustomTool tool) {
    if (tool.handler == CustomToolHandlerType.builtin) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Built-in tools cannot be edited.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => CustomToolEditorScreen(tool: tool)),
    );
  }
  Future<void> _toggleTool(ClaudeCodeCustomTool tool, bool enabled) async {
    final success = await ref
        .read(ccCustomToolsProvider.notifier)
        .toggleTool(tool.id, enabled);
    if (!success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to ${enabled ? 'enable' : 'disable'} tool'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }
  void _confirmDeleteTool(BuildContext context, ClaudeCodeCustomTool tool) {
    if (tool.handler == CustomToolHandlerType.builtin) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Built-in tools cannot be deleted.'),
          behavior: SnackBarBehavior.floating,
        ),
      );
      return;
    }
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete Tool?'),
        content: Text(
          'Are you sure you want to delete "${tool.name}"? This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context);
              final success = await ref
                  .read(ccCustomToolsProvider.notifier)
                  .deleteTool(tool.id);
              if (!success && mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Failed to delete tool'),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              }
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
  }
}
class _EmptyState extends StatelessWidget {
  final VoidCallback onCreateTool;
  const _EmptyState({required this.onCreateTool});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: Insets.xxxl,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              AppIcons.extension_,
              size: 64,
              color: theme.colorScheme.primary.withValues(alpha: 0.5),
            ),
            SizedBox(height: Spacing.lg),
            Text(
              'No Custom Tools',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              'Create custom tools that Claude Code can use.\nHTTP APIs, scripts, and more.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              ),
            ),
            SizedBox(height: Spacing.xxl),
            ElevatedButton.icon(
              onPressed: onCreateTool,
              icon: const Icon(AppIcons.add),
              label: const Text('Create Tool'),
            ),
          ],
        ),
      ),
    );
  }
}
class _ErrorState extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorState({required this.error, required this.onRetry});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: Insets.xxxl,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              AppIcons.error,
              size: 64,
              color: theme.colorScheme.error.withValues(alpha: 0.5),
            ),
            SizedBox(height: Spacing.lg),
            Text(
              'Failed to Load Tools',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              error,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              ),
            ),
            SizedBox(height: Spacing.xxl),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(AppIcons.refresh),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
class _ToolsList extends StatelessWidget {
  final List<ClaudeCodeCustomTool> tools;
  final void Function(ClaudeCodeCustomTool) onEditTool;
  final void Function(ClaudeCodeCustomTool, bool) onToggleTool;
  final void Function(ClaudeCodeCustomTool) onDeleteTool;
  const _ToolsList({
    required this.tools,
    required this.onEditTool,
    required this.onToggleTool,
    required this.onDeleteTool,
  });
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView.builder(
      padding: Insets.card,
      itemCount: tools.length + 1, // +1 for header
      itemBuilder: (context, index) {
        if (index == 0) {
          return Padding(
            padding: const EdgeInsets.only(bottom: Spacing.lg),
            child: Container(
              padding: Insets.card,
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer.withValues(
                  alpha: 0.3,
                ),
                borderRadius: Radii.brMd,
                border: Border.all(
                  color: theme.colorScheme.primary.withValues(alpha: 0.2),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    AppIcons.info,
                    color: theme.colorScheme.primary,
                    size: 20,
                  ),
                  SizedBox(width: Spacing.md),
                  Expanded(
                    child: Text(
                      'Custom tools appear in Claude Code as mcp__broski-custom-tools__<name>',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.primary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        }
        final tool = tools[index - 1];
        return _ToolCard(
          tool: tool,
          onEdit: () => onEditTool(tool),
          onToggle: (enabled) => onToggleTool(tool, enabled),
          onDelete: () => onDeleteTool(tool),
        );
      },
    );
  }
}
class _ToolCard extends StatelessWidget {
  final ClaudeCodeCustomTool tool;
  final VoidCallback onEdit;
  final void Function(bool) onToggle;
  final VoidCallback onDelete;
  const _ToolCard({
    required this.tool,
    required this.onEdit,
    required this.onToggle,
    required this.onDelete,
  });
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: Insets.bottomMd,
      child: InkWell(
        onTap: onEdit,
        borderRadius: Radii.brMd,
        child: Padding(
          padding: Insets.card,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  // Handler type icon
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: _getHandlerColor(
                        tool.handler,
                        theme,
                      ).withValues(alpha: 0.15),
                      borderRadius: Radii.brMd,
                    ),
                    child: Icon(
                      _getHandlerIcon(tool.handler),
                      color: _getHandlerColor(tool.handler, theme),
                      size: 22,
                    ),
                  ),
                  SizedBox(width: Spacing.md),
                  // Tool info
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          tool.name,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        SizedBox(height: Spacing.xxs),
                        Text(
                          tool.handler.displayName,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurface.withValues(
                              alpha: 0.6,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Toggle switch
                  Switch.adaptive(value: tool.enabled, onChanged: onToggle),
                ],
              ),
              if (tool.description.isNotEmpty) ...[
                SizedBox(height: Spacing.md),
                Text(
                  tool.description,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              SizedBox(height: Spacing.md),
              // Parameters and actions row
              Row(
                children: [
                  // Parameters count
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: Radii.brSm,
                    ),
                    child: Text(
                      '${tool.parameters.length} parameter${tool.parameters.length != 1 ? 's' : ''}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.6,
                        ),
                      ),
                    ),
                  ),
                  const Spacer(),
                  // Delete button
                  IconButton(
                    icon: Icon(
                      AppIcons.delete,
                      color: theme.colorScheme.error.withValues(alpha: 0.7),
                      size: 20,
                    ),
                    onPressed: onDelete,
                    tooltip: 'Delete',
                    visualDensity: VisualDensity.compact,
                  ),
                  // Edit button
                  IconButton(
                    icon: Icon(
                      AppIcons.edit,
                      color: theme.colorScheme.primary,
                      size: 20,
                    ),
                    onPressed: onEdit,
                    tooltip: 'Edit',
                    visualDensity: VisualDensity.compact,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
  IconData _getHandlerIcon(CustomToolHandlerType handler) {
    switch (handler) {
      case CustomToolHandlerType.http:
        return AppIcons.http;
      case CustomToolHandlerType.script:
        return AppIcons.terminal;
      case CustomToolHandlerType.builtin:
        return AppIcons.extension_;
    }
  }
  Color _getHandlerColor(CustomToolHandlerType handler, ThemeData theme) {
    final oc = theme.extension<OpenCodeTheme>();
    switch (handler) {
      case CustomToolHandlerType.http:
        return oc?.info ?? theme.colorScheme.primary;
      case CustomToolHandlerType.script:
        return oc?.warning ?? theme.colorScheme.tertiary;
      case CustomToolHandlerType.builtin:
        return oc?.secondary ?? theme.colorScheme.secondary;
    }
  }
}
