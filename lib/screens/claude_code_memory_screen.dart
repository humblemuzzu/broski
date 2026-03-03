
import 'package:flutter/material.dart';
import '../theme/app_typography.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
import '../utils/error_utils.dart';
/// Memory viewer for Claude Code.
/// Shows actual memory entries from ~/.claude/memory/ (user),
/// .claude/memory/ (project), and ~/.claude/memory-local/ (local).
class ClaudeCodeMemoryScreen extends ConsumerStatefulWidget {
  const ClaudeCodeMemoryScreen({super.key});
  @override
  ConsumerState<ClaudeCodeMemoryScreen> createState() =>
      _ClaudeCodeMemoryScreenState();
}
class _ClaudeCodeMemoryScreenState
    extends ConsumerState<ClaudeCodeMemoryScreen> {
  bool _loading = true;
  String? _error;
  List<ClaudeCodeMemoryEntry> _memories = const [];
  String _filterScope = 'all'; // 'all', 'user', 'project', 'local'
  @override
  void initState() {
    super.initState();
    _load();
  }
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final cwd = ref.read(selectionProvider).project?.path;
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final memories = await bridge.ccListMemories(
        scope: _filterScope == 'all' ? null : _filterScope,
        cwd: cwd,
      );
      if (!mounted) return;
      setState(() {
        _memories = memories;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _loading = false;
      });
    }
  }
  Future<void> _deleteMemory(ClaudeCodeMemoryEntry entry) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Memory'),
        content: Text('Delete "${entry.filename}"?\nThis cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Delete', style: TextStyle(color: Theme.of(ctx).extension<OpenCodeTheme>()!.error)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final cwd = ref.read(selectionProvider).project?.path;
    try {
      final bridge = ref.read(bridgeServiceProvider);
      await bridge.ccDeleteMemory(
        scope: entry.scope,
        filename: entry.filename,
        cwd: cwd,
      );
      _load(); // Refresh
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to delete: ${humanizeError(e)}')));
      }
    }
  }
  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    // Count by scope for filter badges
    final userCount = _memories.where((m) => m.scope == 'user').length;
    final projectCount = _memories.where((m) => m.scope == 'project').length;
    final localCount = _memories.where((m) => m.scope == 'local').length;
    final filtered = _filterScope == 'all'
        ? _memories
        : _memories.where((m) => m.scope == _filterScope).toList();
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.background,
        foregroundColor: theme.text,
        title: const Text('Claude Memory'),
        actions: [
          IconButton(
            onPressed: _loading ? null : _load,
            icon: const Icon(AppIcons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: Column(
        children: [
          // Info banner
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: Container(
              padding: Insets.cardSm,
              decoration: BoxDecoration(
                color: theme.backgroundPanel,
                borderRadius: Radii.brMd,
                border: Border.all(
                  color: theme.borderSubtle.withValues(alpha: 0.3),
                ),
              ),
              child: Row(
                children: [
                  Icon(
                    AppIcons.psychology,
                    color: theme.accent,
                    size: 20,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Claude automatically records and recalls memories as it works. '
                      'User memories are global, project memories are per-repo, '
                      'and local memories are machine-specific.',
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Scope filter chips
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
            child: Row(
              children: [
                _scopeChip(theme, 'all', 'All', _memories.length),
                const SizedBox(width: 6),
                _scopeChip(theme, 'user', 'User', userCount),
                const SizedBox(width: 6),
                _scopeChip(theme, 'project', 'Project', projectCount),
                const SizedBox(width: 6),
                _scopeChip(theme, 'local', 'Local', localCount),
              ],
            ),
          ),
          // Content
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _error != null
                ? Center(
                    child: Padding(
                      padding: Insets.cardLg,
                      child: Text(
                        _error!,
                        style: AppTypography.bodySmall(color: theme.error),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                : filtered.isEmpty
                ? Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          AppIcons.memory,
                          color: theme.textMuted,
                          size: 48,
                        ),
                        SizedBox(height: Spacing.md),
                        Text(
                          _memories.isEmpty
                              ? 'No memories yet.\nClaude will create memories as you work together.'
                              : 'No $_filterScope memories found.',
                          style: TextStyle(
                            color: theme.textMuted,
                            fontSize: 13,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  )
                : ListView.separated(
                    padding: Insets.card,
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final entry = filtered[index];
                      return _MemoryCard(
                        theme: theme,
                        entry: entry,
                        onDelete: () => _deleteMemory(entry),
                      );
                    },
                  ),
          ),
        ],
      ),
      ),
    );
  }
  Widget _scopeChip(
    OpenCodeTheme theme,
    String scope,
    String label,
    int count,
  ) {
    final selected = _filterScope == scope;
    return FilterChip(
      selected: selected,
      label: Text(
        '$label ($count)',
        style: TextStyle(
          color: selected ? theme.background : theme.text,
          fontSize: 12,
          fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
        ),
      ),
      selectedColor: theme.accent,
      backgroundColor: theme.backgroundPanel,
      side: BorderSide(
        color: selected
            ? theme.accent
            : theme.borderSubtle.withValues(alpha: 0.3),
      ),
      showCheckmark: false,
      onSelected: (_) {
        setState(() => _filterScope = scope);
        _load();
      },
    );
  }
}
class _MemoryCard extends StatefulWidget {
  const _MemoryCard({
    required this.theme,
    required this.entry,
    required this.onDelete,
  });
  final OpenCodeTheme theme;
  final ClaudeCodeMemoryEntry entry;
  final VoidCallback onDelete;
  @override
  State<_MemoryCard> createState() => _MemoryCardState();
}
class _MemoryCardState extends State<_MemoryCard> {
  bool _expanded = false;
  Color _scopeColor(String scope) {
    switch (scope) {
      case 'user':
        return widget.theme.info;
      case 'project':
        return widget.theme.accent;
      case 'local':
        return widget.theme.warning;
      default:
        return widget.theme.textMuted;
    }
  }
  IconData _scopeIcon(String scope) {
    switch (scope) {
      case 'user':
        return AppIcons.person;
      case 'project':
        return AppIcons.folder;
      case 'local':
        return AppIcons.computer;
      default:
        return AppIcons.memory;
    }
  }

  String? _sourceLabel(String? source) {
    switch (source) {
      case 'auto':
        return 'Auto';
      case 'manual':
        return 'Manual';
      default:
        return null;
    }
  }

  Color _sourceColor(String? source) {
    switch (source) {
      case 'auto':
        return widget.theme.success;
      case 'manual':
        return widget.theme.info;
      default:
        return widget.theme.textMuted;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;
    final entry = widget.entry;
    final scopeColor = _scopeColor(entry.scope);
    final sourceLabel = _sourceLabel(entry.source);
    final sourceColor = _sourceColor(entry.source);
    // Show first ~150 chars as preview
    final preview = entry.content.length > 150
        ? '${entry.content.substring(0, 150)}…'
        : entry.content;
    return Card(
      color: theme.backgroundPanel,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.brMd,
        side: BorderSide(color: theme.borderSubtle.withValues(alpha: 0.2)),
      ),
      child: InkWell(
        borderRadius: Radii.brMd,
        onTap: () => setState(() => _expanded = !_expanded),
        child: Padding(
          padding: Insets.cardSm,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row: scope badge + date + delete
              Row(
                children: [
                  Icon(_scopeIcon(entry.scope), color: scopeColor, size: 16),
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: scopeColor.withValues(alpha: 0.15),
                      borderRadius: Radii.brFull,
                    ),
                    child: Text(
                      entry.scope,
                      style: TextStyle(
                        color: scopeColor,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  if (sourceLabel != null) ...[
                    SizedBox(width: Spacing.xs),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: sourceColor.withValues(alpha: 0.12),
                        borderRadius: Radii.brFull,
                      ),
                      child: Text(
                        sourceLabel,
                        style: TextStyle(
                          color: sourceColor,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ],
                  SizedBox(width: Spacing.sm),
                  if (entry.createdAt != null)
                    Text(
                      entry.createdAt!,
                      style: AppTypography.caption(color: theme.textMuted),
                    ),
                  const Spacer(),
                  Icon(
                    _expanded
                        ? AppIcons.expandLess
                        : AppIcons.expandMore,
                    color: theme.textMuted,
                    size: 20,
                  ),
                  SizedBox(width: Spacing.xs),
                  GestureDetector(
                    onTap: widget.onDelete,
                    child: Icon(
                      AppIcons.delete,
                      color: theme.textMuted,
                      size: 18,
                    ),
                  ),
                ],
              ),
              SizedBox(height: Spacing.sm),
              // Content preview or full
              Text(
                _expanded ? entry.content : preview,
                style: TextStyle(color: theme.text, fontSize: 13, height: 1.4),
              ),
              if (!_expanded && entry.content.length > 150)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    'Tap to expand',
                    style: TextStyle(
                      color: theme.textMuted,
                      fontSize: 11,
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
