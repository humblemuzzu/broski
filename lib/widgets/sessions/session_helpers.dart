import 'dart:async';

import 'package:broski/models/project.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shared helper widgets for sessions screens.
/// Extracted from sessions_screen.dart to avoid circular imports.

class BackgroundTasksChip extends StatelessWidget {
  const BackgroundTasksChip({
    super.key,
    required this.count,
    required this.isExpanded,
    required this.onTap,
    this.onLongPress,
  });
  final int count;
  final bool isExpanded;
  final VoidCallback onTap;

  /// Long-press opens the unified Tasks tab across all backends.
  final VoidCallback? onLongPress;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      borderRadius: Radii.brFull,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: isExpanded
              ? ocTheme.info.withValues(alpha: 0.15)
              : ocTheme.backgroundPanel,
          borderRadius: Radii.brFull,
          border: Border.all(
            color: isExpanded ? ocTheme.info : ocTheme.borderSubtle,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              AppIcons.gitBranch,
              size: 14,
              color: isExpanded ? ocTheme.info : ocTheme.textMuted,
            ),
            const SizedBox(width: 6),
            Text(
              '$count',
              style: TextStyle(
                color: isExpanded ? ocTheme.info : ocTheme.text,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: Spacing.xs),
            AnimatedRotation(
              turns: isExpanded ? 0.5 : 0,
              duration: const Duration(milliseconds: 200),
              child: Icon(
                AppIcons.expandMore,
                size: 16,
                color: isExpanded ? ocTheme.info : ocTheme.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

String filterLabel({
  required String? selectedPath,
  required AsyncValue<List<ProjectSummary>> projects,
}) {
  if (selectedPath == null) return 'All projects';
  final project = projects.valueOrNull?.firstWhere(
    (p) => p.path == selectedPath,
    orElse: () => ProjectSummary(id: 'unknown', name: '', path: selectedPath),
  );
  final name = project?.name ?? '';
  if (name.isNotEmpty) return name;
  final parts = selectedPath.split('/').where((p) => p.isNotEmpty).toList();
  return parts.isEmpty ? 'Project' : parts.last;
}

class FilterChipButton extends StatelessWidget {
  const FilterChipButton({super.key, required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brFull,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brFull,
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.filter, size: 16, color: ocTheme.textMuted),
            const SizedBox(width: Spacing.sm),
            Text(
              label,
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 6),
            Icon(AppIcons.expandMore, size: 18, color: ocTheme.textMuted),
          ],
        ),
      ),
    );
  }
}

class TitleFiltersChip extends StatelessWidget {
  const TitleFiltersChip({super.key, required this.count, required this.onTap});
  final int count;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final hasFilters = count > 0;
    final color = hasFilters ? ocTheme.warning : ocTheme.textMuted;
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brFull,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: hasFilters
              ? ocTheme.warning.withValues(alpha: 0.15)
              : ocTheme.backgroundPanel,
          borderRadius: Radii.brFull,
          border: Border.all(
            color: hasFilters ? ocTheme.warning : ocTheme.borderSubtle,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.filter, size: 14, color: color),
            const SizedBox(width: 6),
            Text(
              hasFilters ? 'Hide $count' : 'Title filters',
              style: TextStyle(
                color: hasFilters ? ocTheme.warning : ocTheme.text,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

void showProjectFilter({
  required BuildContext context,
  required ThemeData theme,
  required String? selectedPath,
  required ProviderListenable<AsyncValue<List<ProjectSummary>>>
  projectsProvider,
  required ValueChanged<String?> onSelected,
}) {
  final ocTheme = OpenCodeTheme.of(context);
  DetailSheet.show(
    context: context,
    title: 'Filter by project',
    initialSize: 0.5,
    minSize: 0.3,
    maxSize: 0.85,
    child: Consumer(
      builder: (context, ref, _) {
        final projects = ref.watch(projectsProvider);
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // All projects option
              FilterProjectTile(
                name: 'All projects',
                path: null,
                isSelected: selectedPath == null,
                onTap: () {
                  onSelected(null);
                  Navigator.pop(context);
                },
              ),
              Divider(height: 24, color: ocTheme.borderSubtle),
              // Project list
              projects.when(
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 32),
                  child: Center(
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
                error: (error, _) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 24),
                  child: Text(
                    'Failed to load projects',
                    style: TextStyle(color: ocTheme.textMuted),
                    textAlign: TextAlign.center,
                  ),
                ),
                data: (items) {
                  if (items.isEmpty) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 24),
                      child: Text(
                        'No projects found',
                        style: TextStyle(color: ocTheme.textMuted),
                        textAlign: TextAlign.center,
                      ),
                    );
                  }
                  final sorted = items.toList()
                    ..sort(
                      (a, b) =>
                          a.name.toLowerCase().compareTo(b.name.toLowerCase()),
                    );
                  return Column(
                    mainAxisSize: MainAxisSize.min,
                    children: sorted.map((project) {
                      final isSelected = selectedPath == project.path;
                      return FilterProjectTile(
                        name: project.name,
                        path: project.path,
                        isSelected: isSelected,
                        onTap: () {
                          onSelected(project.path);
                          Navigator.pop(context);
                        },
                      );
                    }).toList(),
                  );
                },
              ),
            ],
          ),
        );
      },
    ),
  );
}

class FilterProjectTile extends StatelessWidget {
  const FilterProjectTile({
    super.key,
    required this.name,
    required this.path,
    required this.isSelected,
    required this.onTap,
  });
  final String name;
  final String? path;
  final bool isSelected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: Radii.brMd,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          color: isSelected
              ? ocTheme.primary.withValues(alpha: 0.1)
              : Colors.transparent,
          borderRadius: Radii.brMd,
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: TextStyle(
                      color: isSelected ? ocTheme.primary : ocTheme.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (path != null) ...[
                    const SizedBox(height: Spacing.xxs),
                    Text(
                      _shortenPath(path!),
                      style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (isSelected)
              Icon(AppIcons.check, color: ocTheme.primary, size: 20),
          ],
        ),
      ),
    );
  }

  String _shortenPath(String fullPath) {
    // Show only last 2-3 segments for cleaner look
    final parts = fullPath.split('/').where((p) => p.isNotEmpty).toList();
    if (parts.length <= 3) return fullPath;
    return '.../${parts.sublist(parts.length - 3).join('/')}';
  }
}

class LoadMoreButton extends StatelessWidget {
  const LoadMoreButton({
    super.key,
    required this.remainingCount,
    required this.onTap,
  });
  final int remainingCount;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.brMd,
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 14),
          decoration: BoxDecoration(
            color: ocTheme.backgroundElement.withValues(alpha: 0.5),
            borderRadius: Radii.brMd,
            border: Border.all(color: ocTheme.borderSubtle, width: 1),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(AppIcons.expandMore, size: 16, color: ocTheme.primary),
              const SizedBox(width: 6),
              Text(
                'Show $remainingCount more session${remainingCount == 1 ? '' : 's'}',
                style: TextStyle(
                  color: ocTheme.primary,
                  fontSize: 13,
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

class SessionsEmptyState extends StatelessWidget {
  const SessionsEmptyState({super.key});

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: Insets.cardLg,
            decoration: BoxDecoration(
              color: ocTheme.primary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(AppIcons.history, size: 48, color: ocTheme.primary),
          ),
          const SizedBox(height: Spacing.xxl),
          Text(
            'No sessions yet',
            style: TextStyle(
              color: ocTheme.text,
              fontSize: 20,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: Spacing.sm),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: Text(
              'Start a new coding session from the Projects tab',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}

class SkeletonSessionCard extends StatefulWidget {
  const SkeletonSessionCard({super.key});

  @override
  State<SkeletonSessionCard> createState() => SkeletonSessionCardState();
}

class SkeletonSessionCardState extends State<SkeletonSessionCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();
    _animation = Tween<double>(begin: -2, end: 2).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeInOutSine),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Container(
          height: 76,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          decoration: BoxDecoration(
            color: ocTheme.backgroundPanel,
            borderRadius: Radii.brLg,
            border: Border.all(color: ocTheme.borderSubtle),
          ),
          child: Row(
            children: [
              // Skeleton orb
              SkeletonBox(
                width: 44,
                height: 44,
                borderRadius: 12,
                shimmerValue: _animation.value,
              ),
              const SizedBox(width: Spacing.md),
              // Skeleton text lines
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SkeletonBox(
                      width: double.infinity,
                      height: 14,
                      borderRadius: 4,
                      shimmerValue: _animation.value,
                      maxWidthFraction: 0.7,
                    ),
                    const SizedBox(height: Spacing.sm),
                    SkeletonBox(
                      width: double.infinity,
                      height: 12,
                      borderRadius: 4,
                      shimmerValue: _animation.value,
                      maxWidthFraction: 0.5,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: Spacing.sm),
              // Skeleton chevron
              SkeletonBox(
                width: 20,
                height: 20,
                borderRadius: 4,
                shimmerValue: _animation.value,
              ),
            ],
          ),
        );
      },
    );
  }
}

class DelayedSkeletonList extends StatefulWidget {
  const DelayedSkeletonList({super.key});

  @override
  State<DelayedSkeletonList> createState() => DelayedSkeletonListState();
}

class DelayedSkeletonListState extends State<DelayedSkeletonList> {
  bool _showSkeleton = false;
  Timer? _show;

  @override
  void initState() {
    super.initState();
    _show = Timer(const Duration(milliseconds: 100), () {
      if (mounted) setState(() => _showSkeleton = true);
    });
  }

  @override
  void dispose() {
    _show?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!_showSkeleton) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
      child: Column(
        children: List.generate(
          6,
          (index) => const Padding(
            padding: Insets.bottomMd,
            child: SkeletonSessionCard(),
          ),
        ),
      ),
    );
  }
}

class SkeletonBox extends StatelessWidget {
  const SkeletonBox({
    super.key,
    required this.width,
    required this.height,
    required this.borderRadius,
    required this.shimmerValue,
    this.maxWidthFraction = 1.0,
  });
  final double width;
  final double height;
  final double borderRadius;
  final double shimmerValue;
  final double maxWidthFraction;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    // Shimmer gradient that moves
    final baseColor = ocTheme.borderSubtle;
    final highlightColor = ocTheme.textMuted.withValues(alpha: 0.15);
    return LayoutBuilder(
      builder: (context, constraints) {
        final actualWidth = width == double.infinity
            ? constraints.maxWidth * maxWidthFraction
            : width;
        return Container(
          width: actualWidth,
          height: height,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(borderRadius),
            gradient: LinearGradient(
              begin: Alignment(shimmerValue - 1, 0),
              end: Alignment(shimmerValue + 1, 0),
              colors: [baseColor, highlightColor, baseColor],
              stops: const [0.0, 0.5, 1.0],
            ),
          ),
        );
      },
    );
  }
}
