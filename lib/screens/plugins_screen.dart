import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../models/claude_code.dart';
import '../providers/claude_code_provider.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/claude_code_help.dart';

class PluginsScreen extends ConsumerStatefulWidget {
  const PluginsScreen({super.key});

  @override
  ConsumerState<PluginsScreen> createState() => _PluginsScreenState();
}

class _PluginsScreenState extends ConsumerState<PluginsScreen> {
  @override
  void initState() {
    super.initState();
    // Load plugins when screen opens
    Future.microtask(() {
      ref.read(ccPluginsProvider.notifier).load();
    });
  }

  @override
  Widget build(BuildContext context) {
    final pluginsAsync = ref.watch(ccPluginsProvider);
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      appBar: AppBar(
        backgroundColor: theme.colorScheme.surface,
        title: const Text('Plugins'),
        actions: [
          IconButton(
            icon: const Icon(Icons.help_outline_rounded),
            onPressed: () => showClaudeCodeHelpSheet(
              context,
              topic: ClaudeCodeHelpTopic.plugins,
            ),
            tooltip: 'Help',
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: () => ref.read(ccPluginsProvider.notifier).reload(),
            tooltip: 'Reload Plugins',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => _addPluginPath(context),
        tooltip: 'Add Plugin Path',
        child: const Icon(Icons.add),
      ),
      body: pluginsAsync.when(
        data: (plugins) => plugins.isEmpty
            ? _EmptyState(onAddPlugin: () => _addPluginPath(context))
            : _PluginsList(
                plugins: plugins,
                onTogglePlugin: (plugin, enabled) =>
                    _togglePlugin(plugin, enabled),
                onViewDetails: (plugin) => _showPluginDetails(context, plugin),
              ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => _ErrorState(
          error: error.toString(),
          onRetry: () => ref.read(ccPluginsProvider.notifier).load(),
        ),
      ),
    );
  }

  Future<void> _togglePlugin(ClaudeCodePlugin plugin, bool enabled) async {
    final success = await ref
        .read(ccPluginsProvider.notifier)
        .togglePlugin(plugin.name, enabled: enabled);

    if (!success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to ${enabled ? 'enable' : 'disable'} plugin'),
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  void _addPluginPath(BuildContext context) {
    final controller = TextEditingController();
    final theme = Theme.of(context);

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Add Plugin Path'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Enter the path to a Claude Code plugin directory.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              ),
            ),
            SizedBox(height: Spacing.lg),
            TextField(
              controller: controller,
              decoration: const InputDecoration(
                labelText: 'Plugin Path',
                hintText: '/path/to/plugin',
                prefixIcon: Icon(Icons.folder_outlined),
              ),
              autofocus: true,
            ),
            SizedBox(height: Spacing.md),
            Text(
              'The plugin must have a .claude-plugin/plugin.json manifest.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              final path = controller.text.trim();
              if (path.isEmpty) return;

              Navigator.pop(context);
              final success = await ref
                  .read(ccPluginsProvider.notifier)
                  .addPluginPath(path);

              if (mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(
                      success
                          ? 'Plugin added successfully'
                          : 'Failed to add plugin. Make sure the path is valid.',
                    ),
                    behavior: SnackBarBehavior.floating,
                  ),
                );
              }
            },
            child: const Text('Add'),
          ),
        ],
      ),
    );
  }

  void _showPluginDetails(BuildContext context, ClaudeCodePlugin plugin) {
    DetailSheet.show(
      context: context,
      title: plugin.name,
      initialSize: 0.5,
      maxSize: 0.9,
      minSize: 0.4,
      child: _PluginDetailsContent(
        plugin: plugin,
        onRemovePath: () async {
          Navigator.pop(context);
          final success = await ref
              .read(ccPluginsProvider.notifier)
              .removePluginPath(plugin.path);

          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  success
                      ? 'Plugin path removed'
                      : 'Failed to remove plugin path',
                ),
                behavior: SnackBarBehavior.floating,
              ),
            );
          }
        },
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final VoidCallback onAddPlugin;

  const _EmptyState({required this.onAddPlugin});

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
              Icons.extension_rounded,
              size: 64,
              color: theme.colorScheme.primary.withValues(alpha: 0.5),
            ),
            SizedBox(height: Spacing.lg),
            Text(
              'No Plugins Found',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              'Claude Code plugins provide slash commands,\nagents, skills, hooks, and MCP servers.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              ),
            ),
            SizedBox(height: Spacing.sm),
            Text(
              'Place plugins in ~/.claude/plugins/ or add a custom path.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
              ),
            ),
            SizedBox(height: Spacing.xxl),
            ElevatedButton.icon(
              onPressed: onAddPlugin,
              icon: const Icon(Icons.add),
              label: const Text('Add Plugin Path'),
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
              Icons.error_outline_rounded,
              size: 64,
              color: theme.colorScheme.error.withValues(alpha: 0.5),
            ),
            SizedBox(height: Spacing.lg),
            Text(
              'Failed to Load Plugins',
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
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _PluginsList extends StatelessWidget {
  final List<ClaudeCodePlugin> plugins;
  final void Function(ClaudeCodePlugin, bool) onTogglePlugin;
  final void Function(ClaudeCodePlugin) onViewDetails;

  const _PluginsList({
    required this.plugins,
    required this.onTogglePlugin,
    required this.onViewDetails,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // Separate enabled and disabled plugins
    final enabledPlugins = plugins
        .where((p) => p.status == ClaudeCodePluginStatus.enabled)
        .toList();
    final disabledPlugins = plugins
        .where((p) => p.status == ClaudeCodePluginStatus.disabled)
        .toList();

    return ListView(
      padding: Insets.card,
      children: [
        // Info header
        Container(
          padding: Insets.card,
          decoration: BoxDecoration(
            color: theme.colorScheme.primaryContainer.withValues(alpha: 0.3),
            borderRadius: Radii.brMd,
            border: Border.all(
              color: theme.colorScheme.primary.withValues(alpha: 0.2),
            ),
          ),
          child: Row(
            children: [
              Icon(
                Icons.info_outline_rounded,
                color: theme.colorScheme.primary,
                size: 20,
              ),
              SizedBox(width: Spacing.md),
              Expanded(
                child: Text(
                  'Plugins are loaded from ~/.claude/plugins/ and project .claude/plugins/',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
              ),
            ],
          ),
        ),
        SizedBox(height: Spacing.xxl),

        // Enabled plugins section
        if (enabledPlugins.isNotEmpty) ...[
          _SectionHeader(
            title: 'Enabled',
            count: enabledPlugins.length,
            color: theme.colorScheme.primary,
          ),
          SizedBox(height: Spacing.md),
          ...enabledPlugins.map(
            (plugin) => _PluginCard(
              plugin: plugin,
              onToggle: (enabled) => onTogglePlugin(plugin, enabled),
              onTap: () => onViewDetails(plugin),
            ),
          ),
          SizedBox(height: Spacing.xxl),
        ],

        // Disabled plugins section
        if (disabledPlugins.isNotEmpty) ...[
          _SectionHeader(
            title: 'Disabled',
            count: disabledPlugins.length,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
          ),
          SizedBox(height: Spacing.md),
          ...disabledPlugins.map(
            (plugin) => _PluginCard(
              plugin: plugin,
              onToggle: (enabled) => onTogglePlugin(plugin, enabled),
              onTap: () => onViewDetails(plugin),
            ),
          ),
        ],

        // Footer spacing for FAB
        const SizedBox(height: 80),
      ],
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final int count;
  final Color color;

  const _SectionHeader({
    required this.title,
    required this.count,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Row(
      children: [
        Text(
          title,
          style: theme.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
        SizedBox(width: Spacing.sm),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.15),
            borderRadius: Radii.brMd,
          ),
          child: Text(
            '$count',
            style: theme.textTheme.labelSmall?.copyWith(
              color: color,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
      ],
    );
  }
}

class _PluginCard extends StatelessWidget {
  final ClaudeCodePlugin plugin;
  final void Function(bool) onToggle;
  final VoidCallback onTap;

  const _PluginCard({
    required this.plugin,
    required this.onToggle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final manifest = plugin.manifest;
    final isEnabled = plugin.status == ClaudeCodePluginStatus.enabled;

    return Card(
      margin: Insets.bottomMd,
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.brMd,
        child: Padding(
          padding: Insets.card,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  // Plugin icon
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color:
                          (isEnabled
                                  ? theme.colorScheme.primary
                                  : theme.colorScheme.onSurface.withValues(
                                      alpha: 0.5,
                                    ))
                              .withValues(alpha: 0.15),
                      borderRadius: Radii.brMd,
                    ),
                    child: Icon(
                      Icons.extension_rounded,
                      color: isEnabled
                          ? theme.colorScheme.primary
                          : theme.colorScheme.onSurface.withValues(alpha: 0.5),
                      size: 24,
                    ),
                  ),
                  SizedBox(width: Spacing.md),
                  // Plugin info
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          plugin.name,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        if (manifest?.version != null) ...[
                          SizedBox(height: Spacing.xxs),
                          Text(
                            'v${manifest!.version}',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurface.withValues(
                                alpha: 0.6,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  // Toggle switch
                  Switch.adaptive(value: isEnabled, onChanged: onToggle),
                ],
              ),
              if (manifest?.description != null &&
                  manifest!.description!.isNotEmpty) ...[
                SizedBox(height: Spacing.md),
                Text(
                  manifest.description!,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
              SizedBox(height: Spacing.md),
              // Component badges
              Wrap(
                spacing: 8,
                runSpacing: 6,
                children: [
                  if (plugin.commands != null && plugin.commands!.isNotEmpty)
                    _ComponentBadge(
                      icon: Icons.terminal_rounded,
                      label: '${plugin.commands!.length} commands',
                    ),
                  if (plugin.agents != null && plugin.agents!.isNotEmpty)
                    _ComponentBadge(
                      icon: Icons.smart_toy_outlined,
                      label: '${plugin.agents!.length} agents',
                    ),
                  if (plugin.skills != null && plugin.skills!.isNotEmpty)
                    _ComponentBadge(
                      icon: Icons.psychology_outlined,
                      label: '${plugin.skills!.length} skills',
                    ),
                  if (plugin.hasHooks == true)
                    const _ComponentBadge(
                      icon: Icons.webhook_outlined,
                      label: 'hooks',
                    ),
                  if (plugin.hasMcpServers == true)
                    const _ComponentBadge(
                      icon: Icons.dns_outlined,
                      label: 'MCP',
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ComponentBadge extends StatelessWidget {
  final IconData icon;
  final String label;

  const _ComponentBadge({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: Insets.chip,
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: Radii.brSm,
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            icon,
            size: 14,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
          ),
          SizedBox(width: Spacing.xs),
          Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            ),
          ),
        ],
      ),
    );
  }
}

class _PluginDetailsContent extends StatelessWidget {
  final ClaudeCodePlugin plugin;
  final VoidCallback onRemovePath;

  const _PluginDetailsContent({
    required this.plugin,
    required this.onRemovePath,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final manifest = plugin.manifest;

    return Padding(
      padding: Insets.screenAll,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Version badge
          if (manifest?.version != null)
            Padding(
              padding: const EdgeInsets.only(bottom: Spacing.lg),
              child: Container(
                padding: Insets.chip,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primary.withValues(alpha: 0.15),
                  borderRadius: Radii.brSm,
                ),
                child: Text(
                  'v${manifest!.version}',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.primary,
                  ),
                ),
              ),
            ),

          // Description
          if (manifest?.description != null &&
              manifest!.description!.isNotEmpty) ...[
            _DetailSection(
              title: 'Description',
              child: Text(
                manifest.description!,
                style: theme.textTheme.bodyMedium,
              ),
            ),
            SizedBox(height: Spacing.xl),
          ],

          // Path
          _DetailSection(
            title: 'Path',
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    plugin.path,
                    style: AppTypography.code(),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.copy_rounded, size: 18),
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: plugin.path));
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Path copied to clipboard'),
                        behavior: SnackBarBehavior.floating,
                        duration: Duration(seconds: 1),
                      ),
                    );
                  },
                  tooltip: 'Copy path',
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
          ),
          SizedBox(height: Spacing.xl),

          // Author
          if (manifest?.authorName != null) ...[
            _DetailSection(
              title: 'Author',
              child: Text(
                manifest!.authorName!,
                style: theme.textTheme.bodyMedium,
              ),
            ),
            SizedBox(height: Spacing.xl),
          ],

          // Commands
          if (plugin.commands != null && plugin.commands!.isNotEmpty) ...[
            _DetailSection(
              title: 'Commands',
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: plugin.commands!
                    .map(
                      (cmd) => _ComponentChip(
                        icon: Icons.terminal_rounded,
                        label: '/$cmd',
                      ),
                    )
                    .toList(),
              ),
            ),
            SizedBox(height: Spacing.xl),
          ],

          // Agents
          if (plugin.agents != null && plugin.agents!.isNotEmpty) ...[
            _DetailSection(
              title: 'Agents',
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: plugin.agents!
                    .map(
                      (agent) => _ComponentChip(
                        icon: Icons.smart_toy_outlined,
                        label: '@$agent',
                      ),
                    )
                    .toList(),
              ),
            ),
            SizedBox(height: Spacing.xl),
          ],

          // Skills
          if (plugin.skills != null && plugin.skills!.isNotEmpty) ...[
            _DetailSection(
              title: 'Skills',
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: plugin.skills!
                    .map(
                      (skill) => _ComponentChip(
                        icon: Icons.psychology_outlined,
                        label: skill,
                      ),
                    )
                    .toList(),
              ),
            ),
            SizedBox(height: Spacing.xl),
          ],

          // Other components
          if (plugin.hasHooks == true ||
              plugin.hasMcpServers == true) ...[
            _DetailSection(
              title: 'Components',
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (plugin.hasHooks == true)
                    const _ComponentChip(
                      icon: Icons.webhook_outlined,
                      label: 'Hooks',
                    ),
                  if (plugin.hasMcpServers == true)
                    const _ComponentChip(
                      icon: Icons.dns_outlined,
                      label: 'MCP Servers',
                    ),
                ],
              ),
            ),
            SizedBox(height: Spacing.xl),
          ],

          // Remove button (only for custom paths)
          // Note: We can't easily tell if it's a custom path vs built-in,
          // but we offer the option anyway since the bridge validates
          OutlinedButton.icon(
            onPressed: onRemovePath,
            icon: Icon(
              Icons.remove_circle_outline_rounded,
              color: theme.colorScheme.error,
            ),
            label: Text(
              'Remove Plugin Path',
              style: TextStyle(color: theme.colorScheme.error),
            ),
            style: OutlinedButton.styleFrom(
              side: BorderSide(
                color: theme.colorScheme.error.withValues(alpha: 0.5),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _DetailSection extends StatelessWidget {
  final String title;
  final Widget child;

  const _DetailSection({required this.title, required this.child});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: theme.textTheme.labelLarge?.copyWith(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            fontWeight: FontWeight.w600,
          ),
        ),
        SizedBox(height: Spacing.sm),
        child,
      ],
    );
  }
}

class _ComponentChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _ComponentChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer.withValues(alpha: 0.4),
        borderRadius: Radii.brSm,
        border: Border.all(
          color: theme.colorScheme.primary.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: theme.colorScheme.primary),
          const SizedBox(width: 6),
          Text(
            label,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.primary,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
