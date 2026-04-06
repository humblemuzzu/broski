import 'package:broski/models/pi.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/screens/sheets/pi_tree_navigate_dialog.dart';
import 'package:broski/services/bridge/bridge_pi_tools.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/pi/pi_tree_node_tile.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Filter modes matching Pi CLI's tree-selector.
enum TreeFilterMode {
  defaultMode('Default'),
  noTools('No Tools'),
  userOnly('User Only'),
  labeled('Labeled'),
  all('All');

  final String label;
  const TreeFilterMode(this.label);
}

/// Shows the Pi session tree visualization sheet.
///
/// Uses its own DraggableScrollableSheet (not DetailSheet) because
/// the tree ListView needs the scroll controller directly — otherwise
/// the sheet can't drag-to-expand and the list can't scroll.
void showPiTreeSheet(BuildContext context, {String? projectPath}) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    constraints: Responsive.sheetConstraints(context),
    builder: (context) => DraggableScrollableSheet(
      initialChildSize: 0.75,
      maxChildSize: 0.95,
      minChildSize: 0.25,
      expand: false,
      builder: (context, scrollController) {
        return _PiTreeSheet(
          projectPath: projectPath,
          scrollController: scrollController,
        );
      },
    ),
  );
}

class _PiTreeSheet extends ConsumerStatefulWidget {
  final String? projectPath;
  final ScrollController scrollController;
  const _PiTreeSheet({this.projectPath, required this.scrollController});

  @override
  ConsumerState<_PiTreeSheet> createState() => _PiTreeSheetState();
}

class _PiTreeSheetState extends ConsumerState<_PiTreeSheet> {
  String? _selectedNodeId;
  TreeFilterMode _filterMode = TreeFilterMode.defaultMode;
  String _searchQuery = '';
  final _searchController = TextEditingController();
  bool _searchVisible = false;

  String? get _cwd => widget.projectPath ?? ref.read(chatSessionProvider).piCwd;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final cwd = _cwd;
    final treeAsync = ref.watch(piSessionTreeProvider(cwd));
    final labelsAsync = ref.watch(piLabelsProvider(cwd));

    return Container(
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: Radii.sheetTop,
      ),
      child: Column(
        children: [
          // ── Drag handle ──
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 8),
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: theme.textMuted.withValues(alpha: 0.3),
                borderRadius: Radii.brXs,
              ),
            ),
          ),
          // ── Header ──
          Padding(
            padding: Insets.listItemDense,
            child: Stack(
              alignment: Alignment.center,
              children: [
                Text(
                  'Session Tree',
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: Icon(AppIcons.close, color: theme.textMuted, size: 24),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ),
              ],
            ),
          ),
          // ── Body ──
          Expanded(
            child: treeAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => _ErrorView(
                error: '$e',
                onRetry: () => ref.invalidate(piSessionTreeProvider(cwd)),
              ),
              data: (tree) => _buildTreeBody(theme, tree, labelsAsync, cwd),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTreeBody(
    OpenCodeTheme theme,
    PiSessionTree tree,
    AsyncValue<List<PiLabel>> labelsAsync,
    String? cwd,
  ) {
    if (tree.hasError) {
      return _ErrorView(
        error: tree.error!,
        onRetry: () => ref.invalidate(piSessionTreeProvider(cwd)),
      );
    }
    if (tree.nodes.isEmpty) {
      return Center(
        child: Text(
          'No tree entries yet',
          style: AppTypography.bodySmall(color: theme.textMuted),
        ),
      );
    }

    final labels = labelsAsync.valueOrNull ?? const <PiLabel>[];
    final labelMap = <String, String>{
      for (final l in labels) l.entryId: l.label,
    };
    final filtered = _applyFilters(tree, labelMap);

    return Column(
      children: [
        // Filter bar + search
        _FilterBar(
          filterMode: _filterMode,
          totalCount: tree.nodes.length,
          filteredCount: filtered.length,
          labelCount: labels.length,
          searchVisible: _searchVisible,
          onFilterChanged: (mode) => setState(() => _filterMode = mode),
          onSearchToggle: () => setState(() {
            _searchVisible = !_searchVisible;
            if (!_searchVisible) {
              _searchQuery = '';
              _searchController.clear();
            }
          }),
        ),
        if (_searchVisible)
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
            child: TextField(
              controller: _searchController,
              autofocus: true,
              style: AppTypography.bodySmall(color: theme.text),
              decoration: InputDecoration(
                hintText: 'Search entries…',
                hintStyle: AppTypography.bodySmall(color: theme.textMuted),
                prefixIcon:
                    Icon(AppIcons.search, size: 16, color: theme.textMuted),
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                filled: true,
                fillColor: theme.backgroundElement,
                border: OutlineInputBorder(
                  borderRadius: Radii.brSm,
                  borderSide: BorderSide.none,
                ),
              ),
              onChanged: (v) => setState(() => _searchQuery = v),
            ),
          ),
        const SizedBox(height: 4),
        // Tree list — uses the DraggableScrollableSheet's scroll controller
        Expanded(
          child: filtered.isEmpty
              ? Center(
                  child: Text(
                    'No entries match filter',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                )
              : ListView.builder(
                  controller: widget.scrollController,
                  padding: const EdgeInsets.fromLTRB(4, 0, 4, 16),
                  itemCount: filtered.length,
                  itemBuilder: (context, index) {
                    final node = filtered[index];
                    return PiTreeNodeTile(
                      node: node,
                      isCurrentLeaf: node.id == tree.leafId,
                      isSelected: _selectedNodeId == node.id,
                      onTap: () => setState(() {
                        _selectedNodeId =
                            _selectedNodeId == node.id ? null : node.id;
                      }),
                    );
                  },
                ),
        ),
        // Action bar
        if (_selectedNodeId != null)
          _NodeActionBar(
            nodeId: _selectedNodeId!,
            node: _findNode(tree, _selectedNodeId!),
            cwd: cwd,
            onDone: () {
              setState(() => _selectedNodeId = null);
              ref.invalidate(piSessionTreeProvider(cwd));
              ref.invalidate(piLabelsProvider(cwd));
            },
          ),
      ],
    );
  }

  /// Apply filter mode and search query to tree nodes.
  List<PiTreeNode> _applyFilters(
    PiSessionTree tree,
    Map<String, String> labelMap,
  ) {
    return tree.nodes.where((node) {
      if (node.id == tree.leafId) return true;

      if (_filterMode != TreeFilterMode.all && node.isAssistantToolCallOnly) {
        return false;
      }

      switch (_filterMode) {
        case TreeFilterMode.defaultMode:
          if (node.isSettingsEntry) return false;
        case TreeFilterMode.noTools:
          if (node.isSettingsEntry) return false;
          if (node.isToolResult) return false;
          if (node.isBashExecution) return false;
        case TreeFilterMode.userOnly:
          if (!node.isUserMessage) return false;
        case TreeFilterMode.labeled:
          final hasLabel = node.label != null || labelMap.containsKey(node.id);
          if (!hasLabel) return false;
        case TreeFilterMode.all:
          break;
      }

      if (_searchQuery.isNotEmpty) {
        final tokens = _searchQuery
            .toLowerCase()
            .split(RegExp(r'\s+'))
            .where((t) => t.isNotEmpty);
        final searchable = _getSearchableText(node).toLowerCase();
        for (final token in tokens) {
          if (!searchable.contains(token)) return false;
        }
      }

      return true;
    }).toList();
  }

  String _getSearchableText(PiTreeNode node) {
    final parts = <String>[];
    if (node.label != null) parts.add(node.label!);
    if (node.text != null) parts.add(node.text!);
    if (node.role != null) parts.add(node.role!);
    if (node.toolName != null) parts.add(node.toolName!);
    if (node.toolArgs != null) parts.add(node.toolArgs!);
    if (node.command != null) parts.add(node.command!);
    if (node.modelId != null) parts.add(node.modelId!);
    if (node.customType != null) parts.add(node.customType!);
    return parts.join(' ');
  }

  PiTreeNode? _findNode(PiSessionTree tree, String id) {
    for (final n in tree.nodes) {
      if (n.id == id) return n;
    }
    return null;
  }
}

// ── Filter Bar ────────────────────────────────────────────────────

class _FilterBar extends StatelessWidget {
  final TreeFilterMode filterMode;
  final int totalCount;
  final int filteredCount;
  final int labelCount;
  final bool searchVisible;
  final ValueChanged<TreeFilterMode> onFilterChanged;
  final VoidCallback onSearchToggle;

  const _FilterBar({
    required this.filterMode,
    required this.totalCount,
    required this.filteredCount,
    required this.labelCount,
    required this.searchVisible,
    required this.onFilterChanged,
    required this.onSearchToggle,
  });

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 4),
      child: Row(
        children: [
          Text(
            '$filteredCount / $totalCount',
            style: AppTypography.caption(color: theme.textMuted),
          ),
          if (labelCount > 0)
            Text(
              ' · $labelCount labels',
              style: AppTypography.caption(color: theme.warning),
            ),
          const Spacer(),
          _SmallIconButton(
            icon: AppIcons.search,
            isActive: searchVisible,
            onTap: onSearchToggle,
          ),
          const SizedBox(width: 4),
          _FilterDropdown(current: filterMode, onChanged: onFilterChanged),
        ],
      ),
    );
  }
}

class _SmallIconButton extends StatelessWidget {
  final IconData icon;
  final bool isActive;
  final VoidCallback onTap;
  const _SmallIconButton({
    required this.icon,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(5),
        decoration: BoxDecoration(
          color: isActive
              ? theme.primary.withValues(alpha: 0.12)
              : Colors.transparent,
          borderRadius: Radii.brXs,
        ),
        child: Icon(
          icon,
          size: 14,
          color: isActive ? theme.primary : theme.textMuted,
        ),
      ),
    );
  }
}

class _FilterDropdown extends StatelessWidget {
  final TreeFilterMode current;
  final ValueChanged<TreeFilterMode> onChanged;
  const _FilterDropdown({required this.current, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return PopupMenuButton<TreeFilterMode>(
      onSelected: onChanged,
      offset: const Offset(0, 32),
      color: theme.backgroundMenu,
      shape: RoundedRectangleBorder(borderRadius: Radii.brSm),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(
          color: theme.backgroundElement,
          borderRadius: Radii.brXs,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.filter, size: 12, color: theme.textMuted),
            const SizedBox(width: 4),
            Text(
              current.label,
              style: AppTypography.caption(color: theme.text),
            ),
            const SizedBox(width: 2),
            Icon(AppIcons.chevronDown, size: 10, color: theme.textMuted),
          ],
        ),
      ),
      itemBuilder: (_) => TreeFilterMode.values
          .map(
            (mode) => PopupMenuItem(
              value: mode,
              height: 36,
              child: Row(
                children: [
                  Icon(
                    mode == current
                        ? AppIcons.radioChecked
                        : AppIcons.radioUnchecked,
                    size: 14,
                    color: mode == current ? theme.primary : theme.textMuted,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    mode.label,
                    style: AppTypography.bodySmall(
                      color: mode == current ? theme.primary : theme.text,
                    ),
                  ),
                ],
              ),
            ),
          )
          .toList(),
    );
  }
}

// ── Error View ────────────────────────────────────────────────────

class _ErrorView extends StatelessWidget {
  final String error;
  final VoidCallback onRetry;
  const _ErrorView({required this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.cardLg,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(AppIcons.error, color: theme.error, size: 32),
          const SizedBox(height: Spacing.sm),
          Text(
            'Failed to load session tree',
            style: AppTypography.labelLarge(color: theme.text),
          ),
          const SizedBox(height: Spacing.xs),
          Text(
            error,
            style: AppTypography.caption(color: theme.textMuted),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: Spacing.md),
          TextButton(onPressed: onRetry, child: const Text('Retry')),
        ],
      ),
    );
  }
}

// ── Node Action Bar ───────────────────────────────────────────────

class _NodeActionBar extends ConsumerWidget {
  final String nodeId;
  final PiTreeNode? node;
  final String? cwd;
  final VoidCallback onDone;

  const _NodeActionBar({
    required this.nodeId,
    required this.node,
    required this.cwd,
    required this.onDone,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final canFork = node?.isUserMessage ?? false;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        border: Border(top: BorderSide(color: theme.borderSubtle)),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: _ActionButton(
                icon: AppIcons.explore,
                label: 'Navigate',
                color: theme.primary,
                onTap: () => _navigate(context, ref),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _ActionButton(
                icon: AppIcons.edit,
                label: 'Label',
                color: theme.info,
                onTap: () => _addLabel(context, ref),
              ),
            ),
            if (canFork) ...[
              const SizedBox(width: 8),
              Expanded(
                child: _ActionButton(
                  icon: AppIcons.gitFork,
                  label: 'Fork',
                  color: theme.warning,
                  onTap: () => _fork(context, ref),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _navigate(BuildContext context, WidgetRef ref) async {
    final result = await showPiTreeNavigateDialog(
      context: context,
      nodeId: nodeId,
      cwd: cwd,
    );
    if (result == true && context.mounted) {
      // Reload chat messages — the session's leaf moved, so the
      // visible conversation changed. Re-fetch from the bridge
      // and hydrate the chat screen.
      final bridge = ref.read(piBridgeServiceProvider);
      final chat = ref.read(chatSessionProvider.notifier);
      try {
        final messages = await bridge.getMessages(projectPath: cwd);
        chat.hydratePiTranscript(messages);
      } catch (_) {
        // Best effort — navigation already succeeded on the backend
      }

      if (!context.mounted) return;
      Navigator.pop(context);
      showInfo(context, 'Navigated to entry');
      onDone();
    }
  }

  Future<void> _addLabel(BuildContext context, WidgetRef ref) async {
    final theme = OpenCodeTheme.of(context);
    final controller = TextEditingController(text: node?.label ?? '');
    final label = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.backgroundPanel,
        title: Text('Set Label', style: TextStyle(color: theme.text)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: TextStyle(color: theme.text),
          decoration: InputDecoration(
            hintText: 'e.g. working-v1',
            hintStyle: TextStyle(color: theme.textMuted),
          ),
          onSubmitted: (v) => Navigator.pop(ctx, v),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Cancel', style: TextStyle(color: theme.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: Text('Save', style: TextStyle(color: theme.primary)),
          ),
        ],
      ),
    );
    controller.dispose();

    if (label == null || !context.mounted) return;
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      await bridge.setLabel(
        nodeId,
        label: label.trim().isEmpty ? null : label.trim(),
        projectPath: cwd,
      );
      if (context.mounted) showInfo(context, 'Label updated');
      onDone();
    } catch (e) {
      if (context.mounted) showError(context, 'Failed to set label: $e');
    }
  }

  Future<void> _fork(BuildContext context, WidgetRef ref) async {
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      final result = await bridge.fork(entryId: nodeId, projectPath: cwd);
      if (result.cancelled) {
        if (context.mounted) showInfo(context, 'Fork cancelled');
        return;
      }
      if (context.mounted) {
        Navigator.pop(context);
        showInfo(context, 'Forked session');
      }
    } catch (e) {
      if (context.mounted) showError(context, 'Fork failed: $e');
    }
  }
}

// ── Action Button ─────────────────────────────────────────────────

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback onTap;

  const _ActionButton({
    required this.icon,
    required this.label,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color.withValues(alpha: 0.10),
      borderRadius: Radii.brSm,
      child: InkWell(
        borderRadius: Radii.brSm,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 6),
              Text(
                label,
                style: TextStyle(
                  color: color,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
