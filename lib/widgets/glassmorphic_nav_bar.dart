import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:flutter/material.dart';

/// Glassmorphic floating island navigation bar.
///
/// Uses a high-opacity semi-transparent background instead of a live
/// [BackdropFilter] blur. On dark themes the visual result is nearly
/// identical, but we avoid the single most expensive per-frame GPU
/// operation Flutter offers (rasterizing + Gaussian-blurring the entire
/// layer behind the nav bar on every scroll frame).
class GlasmorphicNavBar extends StatelessWidget {
  const GlasmorphicNavBar({
    required this.currentIndex,
    required this.onTap,
    super.key,
  });
  final int currentIndex;
  final ValueChanged<int> onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final tabletMargin = Responsive.navBarHorizontalMargin(context);
    return Container(
      margin: EdgeInsets.fromLTRB(20 + tabletMargin, 0, 20 + tabletMargin, 16),
      decoration: BoxDecoration(
        // High opacity gives the frosted-glass feel without a live blur.
        // 0.88 is the sweet spot — opaque enough to feel glassy, transparent
        // enough to hint at content beneath.
        color: ocTheme.backgroundPanel.withValues(alpha: 0.88),
        borderRadius: Radii.brXxl,
        border: Border.all(
          color: ocTheme.borderSubtle.withValues(alpha: 0.3),
          width: 1,
        ),
        boxShadow: [
          BoxShadow(
            color: ocTheme.bgDeep.withValues(alpha: 0.5),
            blurRadius: 32,
            offset: const Offset(0, 8),
          ),
          BoxShadow(
            color: ocTheme.bgDeep.withValues(alpha: 0.3),
            blurRadius: 16,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: Radii.brXxl,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _GlassNavItem(
                icon: AppIcons.dashboard,
                label: 'Projects',
                isSelected: currentIndex == 0,
                onTap: () => onTap(0),
              ),
              _GlassNavItem(
                icon: AppIcons.folderOpen,
                label: 'Browse',
                isSelected: currentIndex == 1,
                onTap: () => onTap(1),
              ),
              _GlassNavItem(
                icon: AppIcons.chatBubble,
                label: 'Sessions',
                isSelected: currentIndex == 2,
                onTap: () => onTap(2),
              ),
              _GlassNavItem(
                icon: AppIcons.settings,
                label: 'Settings',
                isSelected: currentIndex == 3,
                onTap: () => onTap(3),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GlassNavItem extends StatefulWidget {
  const _GlassNavItem({
    required this.icon,
    required this.label,
    required this.isSelected,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;
  @override
  State<_GlassNavItem> createState() => _GlassNavItemState();
}

class _GlassNavItemState extends State<_GlassNavItem>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 150),
    );
    _scaleAnimation = Tween<double>(
      begin: 1.0,
      end: 0.95,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _handleTapDown(TapDownDetails details) {
    _controller.forward();
  }

  void _handleTapUp(TapUpDetails details) {
    _controller.reverse();
  }

  void _handleTapCancel() {
    _controller.reverse();
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Expanded(
      child: GestureDetector(
        onTap: widget.onTap,
        onTapDown: _handleTapDown,
        onTapUp: _handleTapUp,
        onTapCancel: _handleTapCancel,
        behavior: HitTestBehavior.opaque,
        child: ScaleTransition(
          scale: _scaleAnimation,
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Icon with glow effect when selected
                Container(
                  decoration: widget.isSelected
                      ? BoxDecoration(
                          borderRadius: Radii.brMd,
                          boxShadow: [
                            BoxShadow(
                              color: ocTheme.primary.withValues(alpha: 0.4),
                              blurRadius: 16,
                              spreadRadius: 2,
                            ),
                          ],
                        )
                      : null,
                  child: Icon(
                    widget.icon,
                    color: widget.isSelected
                        ? ocTheme.primary
                        : ocTheme.textMuted.withValues(alpha: 0.7),
                    size: 26,
                  ),
                ),
                const SizedBox(height: 3),
                // Label
                Text(
                  widget.label,
                  style: TextStyle(
                    color: widget.isSelected
                        ? ocTheme.text
                        : ocTheme.textMuted.withValues(alpha: 0.7),
                    fontSize: 11,
                    fontWeight: widget.isSelected
                        ? FontWeight.w600
                        : FontWeight.w500,
                    letterSpacing: -0.2,
                  ),
                ),
                // Active indicator bar
                if (widget.isSelected) ...[
                  const SizedBox(height: 3),
                  Container(
                    width: 32,
                    height: 3,
                    decoration: BoxDecoration(
                      color: ocTheme.primary,
                      borderRadius: Radii.brXs,
                      boxShadow: [
                        BoxShadow(
                          color: ocTheme.primary.withValues(alpha: 0.5),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
