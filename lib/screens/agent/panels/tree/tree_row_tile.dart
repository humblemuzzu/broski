import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/tree/tree_model.dart';
import 'package:broski/screens/agent/panels/tree/tree_node_look.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// One width of a branch step.
const double _step = 14;

/// The depth whose guides are drawn: a deeper tree keeps its indentation here
/// rather than drift past the screen.
const int _deepestShown = 6;

/// One node of the tree: what it is, what it says, its label, and whether the
/// session stands on it.
class TreeRowTile extends StatelessWidget {
  const TreeRowTile({super.key, required this.row, required this.onTap});

  final TreeRow row;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    enabled: onTap != null,
    onTap: onTap,
    label: treeRowSpoken(row),
    excludeSemantics: true,
    child: _Tile(
      key: ValueKey('tree-node:${row.node.id}'),
      row: row,
      onTap: onTap,
    ),
  );
}

class _Tile extends StatelessWidget {
  const _Tile({super.key, required this.row, required this.onTap});

  final TreeRow row;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final levels = row.depth.clamp(0, _deepestShown);
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: Spacing.xs, vertical: 1),
        decoration: BoxDecoration(
          color: row.current
              ? theme.primary.withValues(alpha: 0.06)
              : Colors.transparent,
          borderRadius: Radii.brSm,
          border: Border.all(
            color: row.current
                ? theme.primary.withValues(alpha: 0.2)
                : Colors.transparent,
          ),
        ),
        child: CustomPaint(
          painter: _Guides(
            levels: levels,
            guide: theme.borderSubtle,
            path: theme.borderActive,
            onPath: row.onPath,
          ),
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              Spacing.sm + levels * _step,
              6,
              Spacing.sm,
              6,
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _PathDot(row: row, theme: theme),
                _RoleIcon(kind: row.node.kind, theme: theme),
                const SizedBox(width: Spacing.sm),
                Expanded(
                  child: _RowText(row: row, theme: theme),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The dot a node on the way to the session's position carries.
class _PathDot extends StatelessWidget {
  const _PathDot({required this.row, required this.theme});

  final TreeRow row;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    final size = row.current ? 6.0 : 4.0;
    return SizedBox(
      width: 12,
      child: Padding(
        padding: const EdgeInsets.only(top: 5),
        child: row.onPath
            ? Container(
                width: size,
                height: size,
                decoration: BoxDecoration(
                  color: row.current
                      ? theme.primary
                      : theme.primary.withValues(alpha: 0.55),
                  shape: BoxShape.circle,
                ),
              )
            : null,
      ),
    );
  }
}

class _RoleIcon extends StatelessWidget {
  const _RoleIcon({required this.kind, required this.theme});

  final TreeNodeKind kind;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    final (icon, color) = treeNodeLook(kind, theme);
    return Icon(icon, size: 14, color: color);
  }
}

class _RowText extends StatelessWidget {
  const _RowText({required this.row, required this.theme});

  final TreeRow row;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) {
    final node = row.node;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            Flexible(
              child: Text(
                '${row.cutAbove ? '… ' : ''}${treeNodeKindLabel(node.kind)}',
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: AppTypography.caption(
                  color: row.current ? theme.primary : theme.textMuted,
                ),
              ),
            ),
            if (row.current) ...[
              const SizedBox(width: Spacing.xs),
              _HereBadge(theme: theme),
            ],
          ],
        ),
        Text(
          treeNodeText(node),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: AppTypography.bodySmall(
            color: row.onPath ? theme.text : theme.textMuted,
          ),
        ),
        if (node.label case final label?)
          _LabelChip(label: label, theme: theme),
      ],
    );
  }
}

class _HereBadge extends StatelessWidget {
  const _HereBadge({required this.theme});

  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
    decoration: BoxDecoration(
      color: theme.primary.withValues(alpha: 0.15),
      borderRadius: Radii.brXs,
    ),
    child: Text(
      treeHereLabel,
      style: TextStyle(
        color: theme.primary,
        fontSize: 9,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.5,
      ),
    ),
  );
}

class _LabelChip extends StatelessWidget {
  const _LabelChip({required this.label, required this.theme});

  final String label;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Icon(AppIcons.star, size: 10, color: theme.warning),
      const SizedBox(width: 3),
      Flexible(
        child: Text(
          '#$label',
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppTypography.caption(color: theme.warning),
        ),
      ),
    ],
  );
}

/// The branch guides left of a node: one line per step back towards the root.
class _Guides extends CustomPainter {
  const _Guides({
    required this.levels,
    required this.guide,
    required this.path,
    required this.onPath,
  });

  final int levels;
  final Color guide;
  final Color path;
  final bool onPath;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..strokeWidth = 1;
    for (var level = 0; level < levels; level++) {
      paint.color = onPath && level == levels - 1 ? path : guide;
      final x = level * _step + _step / 2;
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
  }

  @override
  bool shouldRepaint(_Guides old) =>
      old.levels != levels ||
      old.guide != guide ||
      old.path != path ||
      old.onPath != onPath;
}
