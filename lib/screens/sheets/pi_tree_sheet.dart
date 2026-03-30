import 'package:broski/models/pi.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/services/bridge/bridge_pi_tools.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows the Pi session tree visualization sheet.
void showPiTreeSheet(BuildContext context, {String? projectPath}) {
  DetailSheet.show(
    context: context,
    title: 'Session Tree',
    initialSize: 0.7,
    child: _PiTreeSheetContent(projectPath: projectPath),
  );
}

class _PiTreeSheetContent extends ConsumerStatefulWidget {
  final String? projectPath;
  const _PiTreeSheetContent({this.projectPath});

  @override
  ConsumerState<_PiTreeSheetContent> createState() =>
      _PiTreeSheetContentState();
}

class _PiTreeSheetContentState extends ConsumerState<_PiTreeSheetContent> {
  String? _selectedNodeId;

  String? get _cwd => widget.projectPath ?? ref.read(chatSessionProvider).piCwd;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final cwd = _cwd;
    final treeAsync = ref.watch(piSessionTreeProvider(cwd));
    final labelsAsync = ref.watch(piLabelsProvider(cwd));

    return treeAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Padding(
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
              '$e',
              style: AppTypography.caption(color: theme.textMuted),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: Spacing.md),
            TextButton(
              onPressed: () => ref.invalidate(piSessionTreeProvider(cwd)),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
      data: (tree) {
        if (tree.hasError) {
          return Padding(
            padding: Insets.cardLg,
            child: Text(tree.error!, style: TextStyle(color: theme.error)),
          );
        }
        if (tree.nodes.isEmpty) {
          return Padding(
            padding: Insets.cardLg,
            child: Center(
              child: Text(
                'No tree entries yet',
                style: TextStyle(color: theme.textMuted),
              ),
            ),
          );
        }

        // Build label lookup from labels provider.
        final labels = labelsAsync.valueOrNull ?? const <PiLabel>[];
        final labelMap = <String, String>{
          for (final l in labels) l.entryId: l.label,
        };

        return Column(
          children: [
            // Summary bar
            _TreeSummaryBar(tree: tree, labelCount: labels.length),
            const SizedBox(height: Spacing.xs),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(12, 0, 12, 16),
                itemCount: tree.nodes.length,
                itemBuilder: (context, index) {
                  final node = tree.nodes[index];
                  final isLeaf = node.id == tree.leafId;
                  final nodeLabel = node.label ?? labelMap[node.id];
                  return _TreeNodeTile(
                    node: node,
                    isLeaf: isLeaf,
                    isLast: index == tree.nodes.length - 1,
                    label: nodeLabel,
                    isSelected: _selectedNodeId == node.id,
                    onTap: () => setState(() {
                      _selectedNodeId = _selectedNodeId == node.id
                          ? null
                          : node.id;
                    }),
                  );
                },
              ),
            ),
            // Action bar when a node is selected
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
      },
    );
  }

  PiTreeNode? _findNode(PiSessionTree tree, String id) {
    for (final n in tree.nodes) {
      if (n.id == id) return n;
    }
    return null;
  }
}

// ── Summary Bar ─────────────────────────────────────────────────

class _TreeSummaryBar extends StatelessWidget {
  final PiSessionTree tree;
  final int labelCount;
  const _TreeSummaryBar({required this.tree, required this.labelCount});

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final forks = tree.forkPoints.length;
    final parts = <String>[
      '${tree.nodes.length} nodes',
      if (forks > 0) '$forks forks',
      if (labelCount > 0) '$labelCount labels',
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Text(
        parts.join(' · '),
        style: AppTypography.caption(color: theme.textMuted),
      ),
    );
  }
}

// ── Tree Node Tile ──────────────────────────────────────────────

class _TreeNodeTile extends StatelessWidget {
  final PiTreeNode node;
  final bool isLeaf;
  final bool isLast;
  final String? label;
  final bool isSelected;
  final VoidCallback onTap;

  const _TreeNodeTile({
    required this.node,
    required this.isLeaf,
    required this.isLast,
    this.label,
    required this.isSelected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final highlightColor = isLeaf
        ? theme.primary.withValues(alpha: 0.10)
        : Colors.transparent;
    final selectedColor = isSelected
        ? theme.primary.withValues(alpha: 0.06)
        : highlightColor;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: selectedColor,
          borderRadius: Radii.brSm,
          border: isSelected
              ? Border.all(color: theme.primary.withValues(alpha: 0.3))
              : null,
        ),
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Vertical connecting line
              SizedBox(
                width: 28,
                child: CustomPaint(
                  painter: _TreeLinePainter(
                    color: theme.borderSubtle,
                    isLast: isLast,
                    isFork: node.isFork,
                    forkColor: theme.warning,
                  ),
                ),
              ),
              // Node icon
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: _nodeIcon(theme),
              ),
              const SizedBox(width: 8),
              // Content
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              _nodeText(),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: AppTypography.bodySmall(
                                color: isLeaf ? theme.primary : theme.text,
                              ),
                            ),
                          ),
                          if (isLeaf)
                            Container(
                              margin: const EdgeInsets.only(left: 6),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 1,
                              ),
                              decoration: BoxDecoration(
                                color: theme.primary.withValues(alpha: 0.15),
                                borderRadius: Radii.brXs,
                              ),
                              child: Text(
                                'YOU',
                                style: TextStyle(
                                  color: theme.primary,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                        ],
                      ),
                      if (label != null) ...[
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Icon(AppIcons.star, size: 10, color: theme.warning),
                            const SizedBox(width: 4),
                            Text(
                              label!,
                              style: AppTypography.caption(
                                color: theme.warning,
                              ),
                            ),
                          ],
                        ),
                      ],
                      if (node.isFork) ...[
                        const SizedBox(height: 2),
                        Text(
                          '${node.childCount} branches',
                          style: AppTypography.caption(color: theme.textMuted),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 8),
            ],
          ),
        ),
      ),
    );
  }

  Widget _nodeIcon(OpenCodeTheme theme) {
    final IconData icon;
    final Color color;
    if (node.isUserMessage) {
      icon = AppIcons.chatBubble;
      color = theme.info;
    } else if (node.isAssistantMessage) {
      icon = AppIcons.smartToy;
      color = theme.primary;
    } else if (node.isCompaction) {
      icon = AppIcons.compress;
      color = theme.warning;
    } else if (node.isBranchSummary) {
      icon = AppIcons.description;
      color = theme.textMuted;
    } else {
      icon = AppIcons.circleOutlined;
      color = theme.textMuted;
    }
    return Icon(icon, size: 16, color: color);
  }

  String _nodeText() {
    if (node.text != null && node.text!.isNotEmpty) {
      final text = node.text!.replaceAll(RegExp(r'\s+'), ' ').trim();
      return text.length > 80 ? '${text.substring(0, 80)}…' : text;
    }
    if (node.isCompaction) return 'Compaction point';
    if (node.isBranchSummary) return 'Branch summary';
    if (node.isUserMessage) return 'User message';
    if (node.isAssistantMessage) return 'Assistant response';
    return node.type;
  }
}

// ── Tree Line Painter ───────────────────────────────────────────

class _TreeLinePainter extends CustomPainter {
  final Color color;
  final bool isLast;
  final bool isFork;
  final Color forkColor;

  _TreeLinePainter({
    required this.color,
    required this.isLast,
    required this.isFork,
    required this.forkColor,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke;

    final cx = size.width / 2;

    // Vertical line — top to bottom (or top to center if last)
    canvas.drawLine(
      Offset(cx, 0),
      Offset(cx, isLast ? size.height / 2 : size.height),
      paint,
    );

    // Horizontal tick to content
    canvas.drawLine(
      Offset(cx, size.height / 2),
      Offset(size.width, size.height / 2),
      paint,
    );

    // Fork dot
    if (isFork) {
      final forkPaint = Paint()..color = forkColor;
      canvas.drawCircle(Offset(cx, size.height / 2), 3.5, forkPaint);
    }
  }

  @override
  bool shouldRepaint(_TreeLinePainter old) =>
      color != old.color ||
      isLast != old.isLast ||
      isFork != old.isFork ||
      forkColor != old.forkColor;
}

// ── Node Action Bar ─────────────────────────────────────────────

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
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      await bridge.navigateTree(targetId: nodeId, projectPath: cwd);
      if (context.mounted) {
        Navigator.pop(context);
        showInfo(context, 'Navigated to entry');
      }
    } catch (e) {
      if (context.mounted) showError(context, 'Navigate failed: $e');
    }
  }

  Future<void> _addLabel(BuildContext context, WidgetRef ref) async {
    final theme = OpenCodeTheme.of(context);
    final controller = TextEditingController();
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

    if (label == null || label.trim().isEmpty) return;
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      await bridge.setLabel(nodeId, label: label.trim(), projectPath: cwd);
      if (context.mounted) showInfo(context, 'Label set');
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

// ── Action Button ───────────────────────────────────────────────

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
