import 'package:broski/models/claude_code.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/claude_code_help.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Screen for managing Claude Code custom subagents.
/// Subagents are separate agent instances that can be spawned to handle focused subtasks.
class SubagentsScreen extends ConsumerStatefulWidget {
  const SubagentsScreen({super.key});
  @override
  ConsumerState<SubagentsScreen> createState() => _SubagentsScreenState();
}

class _SubagentsScreenState extends ConsumerState<SubagentsScreen> {
  List<Map<String, dynamic>> _filesystemAgents = [];
  bool _loadingFsAgents = false;
  @override
  void initState() {
    super.initState();
    // Load config if not already loaded
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(ccConfigProvider.notifier).load();
      _loadFilesystemAgents();
    });
  }

  void _loadFilesystemAgents() async {
    setState(() => _loadingFsAgents = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final agents = await bridge.ccListAgents();
      if (mounted) {
        setState(() {
          _filesystemAgents = agents
              .where(
                (a) =>
                    a['source'] == 'filesystem' ||
                    a['source'] == 'project' ||
                    a['source'] == 'user',
              )
              .toList();
          _loadingFsAgents = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingFsAgents = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final oc = theme.extension<OpenCodeTheme>()!;
    final configAsync = ref.watch(ccConfigProvider);
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text('Subagents', style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          IconButton(
            icon: const Icon(AppIcons.help),
            tooltip: 'Help',
            onPressed: () => showClaudeCodeHelpSheet(
              context,
              topic: ClaudeCodeHelpTopic.subagents,
            ),
          ),
          IconButton(
            icon: const Icon(AppIcons.add),
            tooltip: 'Add Subagent',
            onPressed: () => _showSubagentEditor(context, null),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: configAsync.when(
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (e, _) => Center(
            child: Text(humanizeError(e), style: TextStyle(color: oc.error)),
          ),
          data: (config) {
            final subagents = config.subagents;
            final hasFilesystem = _filesystemAgents.isNotEmpty;
            final hasConfig = subagents.isNotEmpty;
            // Empty state: only show when BOTH filesystem and config agents are empty
            if (!hasFilesystem && !hasConfig && !_loadingFsAgents) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      AppIcons.agent,
                      size: 64,
                      color: oc.textMuted.withValues(alpha: 0.7),
                    ),
                    const SizedBox(height: Spacing.lg),
                    Text(
                      'No subagents configured',
                      style: TextStyle(color: oc.textMuted, fontSize: 16),
                    ),
                    const SizedBox(height: Spacing.sm),
                    Text(
                      'Subagents can handle focused subtasks\nwith specialized instructions.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: oc.textMuted.withValues(alpha: 0.7),
                        fontSize: 14,
                      ),
                    ),
                    const SizedBox(height: Spacing.xxl),
                    ElevatedButton.icon(
                      onPressed: () => _showSubagentEditor(context, null),
                      icon: const Icon(AppIcons.add),
                      label: const Text('Add Subagent'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: oc.primary,
                        foregroundColor: oc.selectedListItemText,
                      ),
                    ),
                  ],
                ),
              );
            }
            return ListView(
              padding: Insets.card,
              children: [
                // Filesystem agents section (read-only)
                if (_loadingFsAgents)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Spacing.lg),
                    child: Center(
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: oc.textMuted,
                        ),
                      ),
                    ),
                  ),
                if (hasFilesystem) ...[
                  Padding(
                    padding: Insets.bottomSm,
                    child: Row(
                      children: [
                        Icon(AppIcons.folder, size: 14, color: oc.textMuted),
                        const SizedBox(width: 6),
                        Text(
                          'Project Agents (.claude/agents/)',
                          style: TextStyle(
                            color: oc.textMuted,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                  for (final agent in _filesystemAgents)
                    _FilesystemAgentCard(
                      name: agent['name'] as String? ?? 'Unknown',
                      description: agent['description'] as String? ?? '',
                      source: agent['source'] as String? ?? 'filesystem',
                      memoryScope: agent['memory'] as String?,
                      background: agent['background'] as bool? ?? false,
                      isolation: agent['isolation'] as String?,
                    ),
                ],
                // Divider between filesystem and config sections
                if (hasFilesystem && hasConfig)
                  Padding(
                    padding: Insets.cardV,
                    child: Divider(color: oc.border, height: 1),
                  ),
                // Config agents section header
                if (hasConfig) ...[
                  Padding(
                    padding: Insets.bottomSm,
                    child: Row(
                      children: [
                        Icon(AppIcons.settings, size: 14, color: oc.textMuted),
                        const SizedBox(width: 6),
                        Text(
                          'Configured Subagents',
                          style: TextStyle(
                            color: oc.textMuted,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                  for (final subagent in subagents)
                    _SubagentCard(
                      subagent: subagent,
                      isActive: config.activeSubagent == subagent.name,
                      onTap: () => _showSubagentEditor(context, subagent),
                      onSetActive: () => _setActiveSubagent(
                        subagent.name,
                        config.activeSubagent == subagent.name,
                      ),
                      onDelete: () => _deleteSubagent(subagent.name),
                    ),
                ],
              ],
            );
          },
        ),
      ),
    );
  }

  Future<void> _showSubagentEditor(
    BuildContext context,
    ClaudeCodeSubagent? existing,
  ) async {
    final result = await Navigator.push<ClaudeCodeSubagent>(
      context,
      MaterialPageRoute(
        builder: (_) => _SubagentEditorScreen(existing: existing),
      ),
    );
    if (result != null) {
      final notifier = ref.read(ccConfigProvider.notifier);
      if (existing != null) {
        await notifier.updateSubagent(result);
      } else {
        await notifier.addSubagent(result);
      }
    }
  }

  Future<void> _setActiveSubagent(String name, bool isCurrentlyActive) async {
    final notifier = ref.read(ccConfigProvider.notifier);
    await notifier.setActiveSubagent(isCurrentlyActive ? null : name);
  }

  Future<void> _deleteSubagent(String name) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Subagent'),
        content: Text('Are you sure you want to delete "$name"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(ctx).extension<OpenCodeTheme>()!.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await ref.read(ccConfigProvider.notifier).deleteSubagent(name);
    }
  }
}

class _SubagentCard extends StatelessWidget {
  final ClaudeCodeSubagent subagent;
  final bool isActive;
  final VoidCallback onTap;
  final VoidCallback onSetActive;
  final VoidCallback onDelete;
  const _SubagentCard({
    required this.subagent,
    required this.isActive,
    required this.onTap,
    required this.onSetActive,
    required this.onDelete,
  });
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final oc = theme.extension<OpenCodeTheme>()!;
    return Card(
      color: oc.backgroundElement,
      margin: Insets.bottomMd,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.brMd,
        side: isActive
            ? BorderSide(color: oc.primary, width: 2)
            : BorderSide(color: oc.border),
      ),
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
                  Icon(
                    AppIcons.agent,
                    color: isActive ? oc.primary : oc.textMuted,
                    size: 24,
                  ),
                  const SizedBox(width: Spacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              subagent.name,
                              style: TextStyle(
                                color: oc.text,
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            if (isActive) ...[
                              const SizedBox(width: Spacing.sm),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 2,
                                ),
                                decoration: BoxDecoration(
                                  color: oc.primary.withValues(alpha: 0.2),
                                  borderRadius: Radii.brXs,
                                ),
                                child: Text(
                                  'ACTIVE',
                                  style: TextStyle(
                                    color: oc.primary,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                        const SizedBox(height: Spacing.xs),
                        Text(
                          subagent.description,
                          style: AppTypography.bodySmall(color: oc.textMuted),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  PopupMenuButton<String>(
                    icon: Icon(
                      AppIcons.moreVertical,
                      color: oc.textMuted.withValues(alpha: 0.7),
                    ),
                    onSelected: (value) {
                      switch (value) {
                        case 'toggle':
                          onSetActive();
                          break;
                        case 'delete':
                          onDelete();
                          break;
                      }
                    },
                    itemBuilder: (ctx) => [
                      PopupMenuItem(
                        value: 'toggle',
                        child: Row(
                          children: [
                            Icon(
                              isActive
                                  ? AppIcons.radioChecked
                                  : AppIcons.radioUnchecked,
                              size: 20,
                            ),
                            const SizedBox(width: Spacing.sm),
                            Text(isActive ? 'Deactivate' : 'Set Active'),
                          ],
                        ),
                      ),
                      PopupMenuItem(
                        value: 'delete',
                        child: Row(
                          children: [
                            Icon(AppIcons.delete, size: 20, color: oc.error),
                            const SizedBox(width: Spacing.sm),
                            Text('Delete', style: TextStyle(color: oc.error)),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: Spacing.md),
              // Model and tools info
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _InfoChip(
                    icon: AppIcons.memory,
                    label: subagent.model.displayName,
                  ),
                  if (subagent.tools != null && subagent.tools!.isNotEmpty)
                    _InfoChip(
                      icon: AppIcons.build,
                      label: '${subagent.tools!.length} tools',
                    )
                  else
                    const _InfoChip(icon: AppIcons.build, label: 'All tools'),
                  if (subagent.background)
                    const _InfoChip(
                      icon: AppIcons.pending,
                      label: 'Background',
                    ),
                  if (subagent.isolation == 'worktree')
                    const _InfoChip(icon: AppIcons.copy, label: 'Worktree'),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Read-only card for filesystem-based agents (.claude/agents/).
/// These are managed on the user's system, not from the app.
class _FilesystemAgentCard extends StatelessWidget {
  final String name;
  final String description;
  final String source;
  final String? memoryScope;
  final bool background;
  final String? isolation;

  const _FilesystemAgentCard({
    required this.name,
    required this.description,
    required this.source,
    this.memoryScope,
    this.background = false,
    this.isolation,
  });
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final oc = theme.extension<OpenCodeTheme>()!;
    return Card(
      color: oc.backgroundElement,
      margin: Insets.bottomMd,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.brMd,
        side: BorderSide(color: oc.border),
      ),
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Icon(AppIcons.description, color: oc.textMuted, size: 24),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          name,
                          style: TextStyle(
                            color: oc.text,
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: Spacing.sm),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: oc.textMuted.withValues(alpha: 0.15),
                          borderRadius: Radii.brXs,
                        ),
                        child: Text(
                          source.toUpperCase(),
                          style: TextStyle(
                            color: oc.textMuted,
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    ],
                  ),
                  if (description.isNotEmpty) ...[
                    const SizedBox(height: Spacing.xs),
                    Text(
                      description,
                      style: AppTypography.bodySmall(color: oc.textMuted),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if ((memoryScope ?? '').isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Icon(AppIcons.memory, size: 12, color: oc.accent),
                        const SizedBox(width: Spacing.xs),
                        Text(
                          'Memory: $memoryScope',
                          style: TextStyle(
                            color: oc.accent,
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (background || isolation == 'worktree') ...[
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        if (background)
                          const _InfoChip(
                            icon: AppIcons.pending,
                            label: 'Background',
                          ),
                        if (isolation == 'worktree')
                          const _InfoChip(
                            icon: AppIcons.copy,
                            label: 'Worktree',
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;
  const _InfoChip({required this.icon, required this.label});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final oc = theme.extension<OpenCodeTheme>()!;
    return Container(
      padding: Insets.chip,
      decoration: BoxDecoration(
        color: oc.background,
        borderRadius: Radii.brSm,
        border: Border.all(color: oc.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: oc.textMuted.withValues(alpha: 0.7)),
          const SizedBox(width: Spacing.xs),
          Text(label, style: AppTypography.label(color: oc.textMuted)),
        ],
      ),
    );
  }
}

// =============================================================================
// SUBAGENT EDITOR SCREEN
// =============================================================================
class _SubagentEditorScreen extends StatefulWidget {
  final ClaudeCodeSubagent? existing;
  const _SubagentEditorScreen({this.existing});
  @override
  State<_SubagentEditorScreen> createState() => _SubagentEditorScreenState();
}

class _SubagentEditorScreenState extends State<_SubagentEditorScreen> {
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _promptController;
  late final TextEditingController _toolsController;
  late ClaudeCodeSubagentModel _model;
  late ClaudeCodePermissionMode? _permissionMode;
  late final TextEditingController _disallowedToolsController;
  late bool _background;
  late String? _isolation;

  bool get isEditing => widget.existing != null;
  @override
  void initState() {
    super.initState();
    final existing = widget.existing;
    _nameController = TextEditingController(text: existing?.name ?? '');
    _descriptionController = TextEditingController(
      text: existing?.description ?? '',
    );
    _promptController = TextEditingController(text: existing?.prompt ?? '');
    _toolsController = TextEditingController(
      text: existing?.tools?.join(', ') ?? '',
    );
    _model = existing?.model ?? ClaudeCodeSubagentModel.inherit;
    _permissionMode = existing?.permissionMode;
    _disallowedToolsController = TextEditingController(
      text: existing?.disallowedTools?.join(', ') ?? '',
    );
    _background = existing?.background ?? false;
    _isolation = existing?.isolation;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _promptController.dispose();
    _toolsController.dispose();
    _disallowedToolsController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final oc = theme.extension<OpenCodeTheme>()!;
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text('Subagents', style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          TextButton(
            onPressed: _save,
            child: Text(
              'Save',
              style: TextStyle(color: oc.primary, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: SingleChildScrollView(
          padding: Insets.card,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Name field
              _buildLabel('Name', oc),
              const SizedBox(height: Spacing.sm),
              TextField(
                controller: _nameController,
                enabled: !isEditing, // Can't change name when editing
                decoration: _inputDecoration('e.g., code-reviewer', oc),
                style: TextStyle(color: oc.text),
              ),
              if (!isEditing) ...[
                const SizedBox(height: Spacing.xs),
                Text(
                  'A unique identifier for this subagent (cannot be changed later)',
                  style: TextStyle(
                    color: oc.textMuted.withValues(alpha: 0.7),
                    fontSize: 12,
                  ),
                ),
              ],
              const SizedBox(height: Spacing.xxl),
              // Description field
              _buildLabel('Description', oc),
              const SizedBox(height: Spacing.sm),
              TextField(
                controller: _descriptionController,
                decoration: _inputDecoration(
                  'When should Claude use this subagent?',
                  oc,
                ),
                style: TextStyle(color: oc.text),
                maxLines: 2,
              ),
              const SizedBox(height: Spacing.xs),
              Text(
                'Claude uses this to decide when to invoke the subagent',
                style: TextStyle(
                  color: oc.textMuted.withValues(alpha: 0.7),
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: Spacing.xxl),
              // Prompt field
              _buildLabel('System Prompt', oc),
              const SizedBox(height: Spacing.sm),
              TextField(
                controller: _promptController,
                decoration: _inputDecoration(
                  'Instructions for the subagent...',
                  oc,
                ),
                style: TextStyle(color: oc.text),
                maxLines: 6,
                minLines: 4,
              ),
              const SizedBox(height: Spacing.xs),
              Text(
                'Defines the subagent\'s role, expertise, and behavior',
                style: TextStyle(
                  color: oc.textMuted.withValues(alpha: 0.7),
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: Spacing.xxl),
              // Model dropdown
              _buildLabel('Model', oc),
              const SizedBox(height: Spacing.sm),
              Container(
                padding: Insets.cardH,
                decoration: BoxDecoration(
                  color: oc.backgroundElement,
                  borderRadius: Radii.brSm,
                  border: Border.all(color: oc.border),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<ClaudeCodeSubagentModel>(
                    value: _model,
                    isExpanded: true,
                    dropdownColor: oc.backgroundElement,
                    style: TextStyle(color: oc.text),
                    items: ClaudeCodeSubagentModel.values.map((m) {
                      return DropdownMenuItem(
                        value: m,
                        child: Text(m.displayName),
                      );
                    }).toList(),
                    onChanged: (value) {
                      if (value != null) {
                        setState(() => _model = value);
                      }
                    },
                  ),
                ),
              ),
              const SizedBox(height: Spacing.xs),
              Text(
                'Inherit uses the main model; others override it',
                style: TextStyle(
                  color: oc.textMuted.withValues(alpha: 0.7),
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: Spacing.xxl),
              // Permission Mode dropdown (SDK v2.0.43)
              _buildLabel('Permission Mode (optional)', oc),
              const SizedBox(height: Spacing.sm),
              Container(
                padding: Insets.cardH,
                decoration: BoxDecoration(
                  color: oc.backgroundElement,
                  borderRadius: Radii.brSm,
                  border: Border.all(color: oc.border),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<ClaudeCodePermissionMode?>(
                    value: _permissionMode,
                    isExpanded: true,
                    dropdownColor: oc.backgroundElement,
                    style: TextStyle(color: oc.text),
                    hint: Text(
                      'Inherit from config',
                      style: TextStyle(color: oc.textMuted),
                    ),
                    items: [
                      DropdownMenuItem<ClaudeCodePermissionMode?>(
                        value: null,
                        child: Text(
                          'Inherit from config',
                          style: TextStyle(color: oc.textMuted),
                        ),
                      ),
                      ...ClaudeCodePermissionMode.values.map((m) {
                        return DropdownMenuItem(
                          value: m,
                          child: Text(m.displayName),
                        );
                      }),
                    ],
                    onChanged: (value) {
                      setState(() => _permissionMode = value);
                    },
                  ),
                ),
              ),
              const SizedBox(height: Spacing.xs),
              Text(
                'Override permission mode for this subagent only',
                style: TextStyle(
                  color: oc.textMuted.withValues(alpha: 0.7),
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: Spacing.xxl),
              _buildLabel('Background Task', oc),
              const SizedBox(height: Spacing.sm),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _background,
                title: const Text('Run subagent in background by default'),
                subtitle: const Text(
                  'When enabled, this subagent can keep running while you continue chatting.',
                ),
                onChanged: (value) {
                  setState(() => _background = value);
                },
              ),
              const SizedBox(height: Spacing.xxl),
              _buildLabel('Isolation', oc),
              const SizedBox(height: Spacing.sm),
              Container(
                padding: Insets.cardH,
                decoration: BoxDecoration(
                  color: oc.backgroundElement,
                  borderRadius: Radii.brSm,
                  border: Border.all(color: oc.border),
                ),
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<String?>(
                    value: _isolation,
                    isExpanded: true,
                    dropdownColor: oc.backgroundElement,
                    style: TextStyle(color: oc.text),
                    items: const [
                      DropdownMenuItem<String?>(
                        value: null,
                        child: Text('None'),
                      ),
                      DropdownMenuItem<String?>(
                        value: 'worktree',
                        child: Text('Worktree isolation'),
                      ),
                    ],
                    onChanged: (value) {
                      setState(() => _isolation = value);
                    },
                  ),
                ),
              ),
              const SizedBox(height: Spacing.xs),
              Text(
                'Worktree isolation runs the subagent in a temporary git worktree.',
                style: TextStyle(
                  color: oc.textMuted.withValues(alpha: 0.7),
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: Spacing.xxl),
              // Tools field
              _buildLabel('Allowed Tools (optional)', oc),
              const SizedBox(height: Spacing.sm),
              TextField(
                controller: _toolsController,
                decoration: _inputDecoration('e.g., Read, Grep, Glob', oc),
                style: TextStyle(color: oc.text),
              ),
              const SizedBox(height: Spacing.xs),
              Text(
                'Comma-separated list of tool names. Leave empty to inherit all tools.',
                style: TextStyle(
                  color: oc.textMuted.withValues(alpha: 0.7),
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: Spacing.xxxl),
              // Disallowed Tools field (SDK v2.0.30)
              _buildLabel('Disallowed Tools (optional)', oc),
              const SizedBox(height: Spacing.sm),
              TextField(
                controller: _disallowedToolsController,
                decoration: _inputDecoration(
                  'e.g., Bash, Write, Task(agent-name)',
                  oc,
                ),
                style: TextStyle(color: oc.text),
              ),
              const SizedBox(height: Spacing.xs),
              Text(
                'Tools this subagent cannot use. Supports wildcards like Bash(npm *)',
                style: TextStyle(
                  color: oc.textMuted.withValues(alpha: 0.7),
                  fontSize: 12,
                ),
              ),
              const SizedBox(height: Spacing.xxxl),
              // Common tool presets
              Text(
                'Tool Presets',
                style: TextStyle(
                  color: oc.textMuted,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: Spacing.md),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  _PresetChip(
                    label: 'Read-only',
                    onTap: () => _toolsController.text = 'Read, Grep, Glob',
                  ),
                  _PresetChip(
                    label: 'Test runner',
                    onTap: () => _toolsController.text = 'Bash, Read, Grep',
                  ),
                  _PresetChip(
                    label: 'Code editor',
                    onTap: () =>
                        _toolsController.text = 'Read, Edit, Write, Grep, Glob',
                  ),
                  _PresetChip(
                    label: 'All tools',
                    onTap: () => _toolsController.text = '',
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLabel(String text, OpenCodeTheme oc) {
    return Text(
      text,
      style: TextStyle(
        color: oc.textMuted,
        fontSize: 14,
        fontWeight: FontWeight.w600,
      ),
    );
  }

  InputDecoration _inputDecoration(String hint, OpenCodeTheme oc) {
    return InputDecoration(
      hintText: hint,
      hintStyle: TextStyle(color: oc.textMuted.withValues(alpha: 0.7)),
      filled: true,
      fillColor: oc.backgroundElement,
      border: OutlineInputBorder(
        borderRadius: Radii.brSm,
        borderSide: BorderSide(color: oc.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: Radii.brSm,
        borderSide: BorderSide(color: oc.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: Radii.brSm,
        borderSide: BorderSide(color: oc.primary),
      ),
      disabledBorder: OutlineInputBorder(
        borderRadius: Radii.brSm,
        borderSide: BorderSide(color: oc.border.withValues(alpha: 0.5)),
      ),
    );
  }

  void _save() {
    final name = _nameController.text.trim();
    final description = _descriptionController.text.trim();
    final prompt = _promptController.text.trim();
    if (name.isEmpty) {
      showInfo(context, 'Name is required');
      return;
    }
    if (description.isEmpty) {
      showInfo(context, 'Description is required');
      return;
    }
    if (prompt.isEmpty) {
      showInfo(context, 'System prompt is required');
      return;
    }
    // Parse tools
    List<String>? tools;
    final toolsText = _toolsController.text.trim();
    if (toolsText.isNotEmpty) {
      tools = toolsText
          .split(',')
          .map((t) => t.trim())
          .where((t) => t.isNotEmpty)
          .toList();
    }
    // Parse disallowed tools
    List<String>? disallowedTools;
    final disallowedText = _disallowedToolsController.text.trim();
    if (disallowedText.isNotEmpty) {
      disallowedTools = disallowedText
          .split(',')
          .map((t) => t.trim())
          .where((t) => t.isNotEmpty)
          .toList();
    }
    final subagent = ClaudeCodeSubagent(
      name: name,
      description: description,
      prompt: prompt,
      tools: tools,
      model: _model,
      permissionMode: _permissionMode,
      disallowedTools: disallowedTools,
      background: _background,
      isolation: _isolation,
    );
    Navigator.pop(context, subagent);
  }
}

class _PresetChip extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _PresetChip({required this.label, required this.onTap});
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final oc = theme.extension<OpenCodeTheme>()!;
    return ActionChip(
      label: Text(label),
      labelStyle: AppTypography.label(color: oc.textMuted),
      backgroundColor: oc.backgroundElement,
      side: BorderSide(color: oc.border),
      onPressed: onTap,
    );
  }
}
