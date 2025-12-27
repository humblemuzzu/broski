import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/project.dart';
import '../models/session.dart';
import '../providers/chat_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/sessions_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import '../widgets/background_session_widgets.dart';
import 'chat_screen.dart';

class SessionsScreen extends ConsumerStatefulWidget {
  const SessionsScreen({super.key});

  @override
  ConsumerState<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends ConsumerState<SessionsScreen> {
  Future<void> _refresh() async {
    ref.read(sessionsRefreshTickProvider.notifier).state++;
    ref.invalidate(sessionsListProvider);
    ref.invalidate(projectsForSessionsProvider);
    // Also refresh session statuses
    ref.read(globalSessionStatusProvider.notifier).fetchAllStatuses();
    await ref.read(sessionsListProvider.future);
  }

  @override
  void initState() {
    super.initState();
    // Fetch initial session statuses after first frame
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(globalSessionStatusProvider.notifier).fetchAllStatuses();
    });
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final theme = Theme.of(context);
    final filterProjectPath = ref.watch(sessionsFilterProjectPathProvider);
    final projectsAsync = ref.watch(projectsForSessionsProvider);
    final sessionsAsync = ref.watch(sessionsListProvider);
    // Watch global session statuses for real-time updates
    final sessionStatuses = ref.watch(globalSessionStatusProvider);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refresh,
          color: theme.colorScheme.primary,
          backgroundColor: theme.colorScheme.surface,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              // Active Sessions Section (sticky at top) - shows running sessions
              SliverToBoxAdapter(
                child: ActiveSessionsSection(
                  onSessionTap: (session) => _openSession(session),
                ),
              ),
              SliverToBoxAdapter(
                child: Builder(
                  builder: (context) {
                    // Count background tasks from grouped sessions
                    final groupedSessions = ref.watch(groupedSessionsProvider);
                    final backgroundTaskCount = groupedSessions.fold<int>(
                      0,
                      (sum, g) => sum + g.children.length,
                    );
                    final showBgTasks = ref.watch(showBackgroundTasksProvider);

                    return _ModernHeader(
                      connection: connection,
                      filterProjectPath: filterProjectPath,
                      projects: projectsAsync,
                      onFilterChanged: (path) {
                        ref
                                .read(
                                  sessionsFilterProjectPathProvider.notifier,
                                )
                                .state =
                            path;
                        ref.read(sessionsRefreshTickProvider.notifier).state++;
                      },
                      onRefresh: _refresh,
                      showBackgroundTasks: showBgTasks,
                      onToggleBackgroundTasks: () {
                        ref.read(showBackgroundTasksProvider.notifier).state =
                            !showBgTasks;
                        // Collapse all when hiding
                        if (showBgTasks) {
                          ref
                              .read(expandedSessionsProvider.notifier)
                              .collapseAll();
                        }
                      },
                      backgroundTaskCount: backgroundTaskCount,
                    );
                  },
                ),
              ),
              ...sessionsAsync.when(
                loading: () => [
                  // Smart skeleton: only show after 100ms delay to prevent flash
                  SliverToBoxAdapter(child: _DelayedSkeletonList()),
                ],
                error: (error, _) => [
                  SliverFillRemaining(
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(
                            Icons.error_outline_rounded,
                            color: theme.colorScheme.error,
                            size: 48,
                          ),
                          const SizedBox(height: 16),
                          Text(
                            'Failed to load sessions',
                            style: TextStyle(
                              color: theme.colorScheme.onSurface,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 24),
                            child: Text(
                              '$error',
                              style: TextStyle(
                                color: theme.colorScheme.onSurface.withValues(
                                  alpha: 0.6,
                                ),
                                fontSize: 14,
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
                data: (sessions) {
                  if (sessions.isEmpty) {
                    return [SliverFillRemaining(child: _EmptyState())];
                  }

                  // Use grouped sessions for hierarchical display
                  final groupedSessions = ref.watch(groupedSessionsProvider);
                  final showBgTasks = ref.watch(showBackgroundTasksProvider);
                  final expandedSessions = ref.watch(expandedSessionsProvider);

                  // Filter to only root sessions (background tasks are nested)
                  final rootSessions = sessions
                      .where((s) => s.isRootSession)
                      .toList();

                  // Predictive prefetching: preload messages for top 3 root sessions
                  // Fire-and-forget after frame is rendered
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    prefetchTopSessions(ref, rootSessions);
                  });

                  final projectsByPath = <String, ProjectSummary>{};
                  for (final p
                      in projectsAsync.valueOrNull ??
                          const <ProjectSummary>[]) {
                    projectsByPath[p.path] = p;
                  }

                  // Build items using grouped sessions
                  final items = _buildGroupedListItems(
                    groupedSessions: groupedSessions,
                    projectsByPath: projectsByPath,
                    grouped: filterProjectPath == null,
                    showBackgroundTasks: showBgTasks,
                    expandedSessions: expandedSessions,
                  );

                  return [
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate((context, index) {
                          final item = items[index];
                          final ocTheme = OpenCodeTheme.of(context);
                          if (item is _SessionListHeader) {
                            return Padding(
                              padding: const EdgeInsets.fromLTRB(4, 14, 4, 10),
                              child: Text(
                                item.title.toUpperCase(),
                                style: TextStyle(
                                  color: ocTheme.textMuted,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0.5,
                                ),
                              ),
                            );
                          }

                          if (item is _SessionListItem) {
                            final session = item.session;
                            final status = sessionStatuses[session.id];
                            final grouped = groupedSessions.firstWhere(
                              (g) => g.session.id == session.id,
                              orElse: () =>
                                  SessionWithChildren(session: session),
                            );
                            final isExpanded = expandedSessions.contains(
                              session.id,
                            );
                            final hasChildren = grouped.hasChildren;

                            return Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: _SessionCard(
                                session: session,
                                status: status,
                                isOfflineMode: connection.isOfflineMode,
                                onTap: () => _openSession(session),
                                onDelete: connection.isOfflineMode
                                    ? null
                                    : () => _deleteSession(session),
                                onRename: connection.isOfflineMode
                                    ? null
                                    : () => _showRenameDialog(session),
                                // Background task expansion
                                childCount: showBgTasks && hasChildren
                                    ? grouped.children.length
                                    : 0,
                                isExpanded: isExpanded,
                                onToggleExpand: showBgTasks && hasChildren
                                    ? () => ref
                                          .read(
                                            expandedSessionsProvider.notifier,
                                          )
                                          .toggle(session.id)
                                    : null,
                                activeChildCount: showBgTasks
                                    ? grouped.activeChildCount(sessionStatuses)
                                    : 0,
                              ),
                            );
                          }

                          if (item is _ChildSessionItem) {
                            final session = item.session;
                            final status = sessionStatuses[session.id];
                            return Padding(
                              padding: const EdgeInsets.only(
                                left: 24,
                                bottom: 8,
                              ),
                              child: _ChildSessionCard(
                                session: session,
                                status: status,
                                isOfflineMode: connection.isOfflineMode,
                                onTap: () => _openSession(session),
                              ),
                            );
                          }

                          return const SizedBox.shrink();
                        }, childCount: items.length),
                      ),
                    ),
                  ];
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openSession(SessionSummary session) async {
    final chat = ref.read(chatSessionProvider.notifier);
    chat.setSession(session, projectPath: session.directory);

    final project = ProjectSummary(
      id: session.projectID,
      name: session.directory.split('/').where((item) => item.isNotEmpty).last,
      path: session.directory,
    );

    if (!mounted) return;
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen(project: project, session: session),
      ),
    );
    if (!mounted) return;
    ref.read(sessionsRefreshTickProvider.notifier).state++;
  }

  // Feature 4: Delete session
  Future<void> _deleteSession(SessionSummary session) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Delete Session?'),
        content: Text(
          'Are you sure you want to delete "${session.title}"? This action cannot be undone.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              'Delete',
              style: TextStyle(color: OpenCodeTheme.of(context).error),
            ),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    final bridge = ref.read(bridgeServiceProvider);
    final success = await bridge.deleteSession(
      session.id,
      projectPath: session.directory,
    );

    if (!mounted) return;

    final ocTheme = OpenCodeTheme.of(context);
    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Session deleted'),
          backgroundColor: ocTheme.backgroundPanel,
        ),
      );
      _refresh();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Failed to delete session'),
          backgroundColor: ocTheme.error,
        ),
      );
    }
  }

  // Feature 5: Rename session
  Future<void> _showRenameDialog(SessionSummary session) async {
    final controller = TextEditingController(text: session.title);

    final newTitle = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Rename Session'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Enter new title',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (value) => Navigator.pop(context, value.trim()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (newTitle == null || newTitle.isEmpty || newTitle == session.title) {
      return;
    }

    final bridge = ref.read(bridgeServiceProvider);
    try {
      await bridge.updateSession(
        session.id,
        title: newTitle,
        projectPath: session.directory,
      );

      if (!mounted) return;

      final ocTheme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Session renamed to "$newTitle"'),
          backgroundColor: ocTheme.backgroundPanel,
        ),
      );
      _refresh();
    } catch (e) {
      if (!mounted) return;
      final ocTheme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Failed to rename session'),
          backgroundColor: ocTheme.error,
        ),
      );
    }
  }
}

sealed class _SessionRowItem {}

final class _SessionListHeader extends _SessionRowItem {
  _SessionListHeader(this.title);
  final String title;
}

final class _SessionListItem extends _SessionRowItem {
  _SessionListItem(this.session);
  final SessionSummary session;
}

/// Child session item (background task nested under parent)
final class _ChildSessionItem extends _SessionRowItem {
  _ChildSessionItem(this.session);
  final SessionSummary session;
}

/// Build list items with grouped sessions (parent + children)
List<_SessionRowItem> _buildGroupedListItems({
  required List<SessionWithChildren> groupedSessions,
  required Map<String, ProjectSummary> projectsByPath,
  required bool grouped,
  required bool showBackgroundTasks,
  required Set<String> expandedSessions,
}) {
  String displayNameForDirectory(String directory) {
    final project = projectsByPath[directory];
    if (project != null && project.name.isNotEmpty) return project.name;
    final parts = directory.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Global' : parts.last;
  }

  if (!grouped) {
    // No project grouping, just show all root sessions
    final items = <_SessionRowItem>[];
    for (final g in groupedSessions) {
      items.add(_SessionListItem(g.session));
      // Add children if expanded
      if (showBackgroundTasks &&
          g.hasChildren &&
          expandedSessions.contains(g.session.id)) {
        for (final child in g.children) {
          items.add(_ChildSessionItem(child));
        }
      }
    }
    return items;
  }

  // Group by directory (project)
  final groups = <String, List<SessionWithChildren>>{};
  for (final g in groupedSessions) {
    groups.putIfAbsent(g.session.directory, () => []).add(g);
  }

  final directories = groups.keys.toList()
    ..sort((a, b) {
      final aMax = groups[a]!
          .map((g) => g.session.time.updated)
          .fold<int>(0, (prev, v) => v > prev ? v : prev);
      final bMax = groups[b]!
          .map((g) => g.session.time.updated)
          .fold<int>(0, (prev, v) => v > prev ? v : prev);
      return bMax.compareTo(aMax);
    });

  final items = <_SessionRowItem>[];
  for (final directory in directories) {
    items.add(_SessionListHeader(displayNameForDirectory(directory)));
    final group = groups[directory]!
      ..sort((a, b) => b.session.time.updated - a.session.time.updated);
    for (final g in group) {
      items.add(_SessionListItem(g.session));
      // Add children if expanded
      if (showBackgroundTasks &&
          g.hasChildren &&
          expandedSessions.contains(g.session.id)) {
        for (final child in g.children) {
          items.add(_ChildSessionItem(child));
        }
      }
    }
  }
  return items;
}

// Modern header
class _ModernHeader extends StatelessWidget {
  const _ModernHeader({
    required this.connection,
    required this.filterProjectPath,
    required this.projects,
    required this.onFilterChanged,
    required this.onRefresh,
    required this.showBackgroundTasks,
    required this.onToggleBackgroundTasks,
    required this.backgroundTaskCount,
  });

  final BridgeConnectionState connection;
  final String? filterProjectPath;
  final AsyncValue<List<ProjectSummary>> projects;
  final ValueChanged<String?> onFilterChanged;
  final VoidCallback onRefresh;
  final bool showBackgroundTasks;
  final VoidCallback onToggleBackgroundTasks;
  final int backgroundTaskCount;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final filterLabel = _filterLabel(
      selectedPath: filterProjectPath,
      projects: projects,
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Sessions',
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 32,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              IconButton(
                onPressed: onRefresh,
                icon: Icon(Icons.refresh_rounded, color: ocTheme.textMuted),
                tooltip: 'Refresh',
              ),
              // Connection indicator
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: connection.isConnected
                      ? ocTheme.success.withValues(alpha: 0.15)
                      : ocTheme.error.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: connection.isConnected
                            ? ocTheme.success
                            : ocTheme.error,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Continue your AI coding sessions',
            style: TextStyle(
              color: ocTheme.textMuted,
              fontSize: 15,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              _FilterChipButton(
                label: filterLabel,
                onTap: () => _showProjectFilter(
                  context: context,
                  theme: theme,
                  selectedPath: filterProjectPath,
                  projects: projects,
                  onSelected: onFilterChanged,
                ),
              ),
              const SizedBox(width: 8),
              // Background tasks toggle
              if (backgroundTaskCount > 0)
                _BackgroundTasksChip(
                  count: backgroundTaskCount,
                  isExpanded: showBackgroundTasks,
                  onTap: onToggleBackgroundTasks,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Chip button to toggle background tasks visibility
class _BackgroundTasksChip extends StatelessWidget {
  const _BackgroundTasksChip({
    required this.count,
    required this.isExpanded,
    required this.onTap,
  });

  final int count;
  final bool isExpanded;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: isExpanded
              ? ocTheme.info.withValues(alpha: 0.15)
              : ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: isExpanded ? ocTheme.info : ocTheme.borderSubtle,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.account_tree_rounded,
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
            const SizedBox(width: 4),
            AnimatedRotation(
              turns: isExpanded ? 0.5 : 0,
              duration: const Duration(milliseconds: 200),
              child: Icon(
                Icons.expand_more_rounded,
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

String _filterLabel({
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

class _FilterChipButton extends StatelessWidget {
  const _FilterChipButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.filter_list_rounded, size: 16, color: ocTheme.textMuted),
            const SizedBox(width: 8),
            Text(
              label,
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(width: 6),
            Icon(Icons.expand_more_rounded, size: 18, color: ocTheme.textMuted),
          ],
        ),
      ),
    );
  }
}

void _showProjectFilter({
  required BuildContext context,
  required ThemeData theme,
  required String? selectedPath,
  required AsyncValue<List<ProjectSummary>> projects,
  required ValueChanged<String?> onSelected,
}) {
  final ocTheme = OpenCodeTheme.of(context);
  showModalBottomSheet<void>(
    context: context,
    backgroundColor: ocTheme.backgroundPanel,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) {
      final sheetOcTheme = OpenCodeTheme.of(context);
      return DraggableScrollableSheet(
        initialChildSize: 0.5,
        minChildSize: 0.3,
        maxChildSize: 0.85,
        expand: false,
        builder: (context, scrollController) {
          return Column(
            children: [
              // Drag handle
              Container(
                margin: const EdgeInsets.only(top: 12, bottom: 8),
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: sheetOcTheme.textMuted.withValues(alpha: 0.3),
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              // Header
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 12, 0),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        'Filter by project',
                        style: TextStyle(
                          color: sheetOcTheme.text,
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: Icon(
                        Icons.close_rounded,
                        color: sheetOcTheme.textMuted,
                        size: 22,
                      ),
                      visualDensity: VisualDensity.compact,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 4),
              // Scrollable content
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
                  children: [
                    // All projects option
                    _FilterProjectTile(
                      name: 'All projects',
                      path: null,
                      isSelected: selectedPath == null,
                      onTap: () {
                        onSelected(null);
                        Navigator.pop(context);
                      },
                    ),
                    Divider(height: 24, color: sheetOcTheme.borderSubtle),
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
                          style: TextStyle(color: sheetOcTheme.textMuted),
                          textAlign: TextAlign.center,
                        ),
                      ),
                      data: (items) {
                        final sorted = items.toList()
                          ..sort(
                            (a, b) => a.name.toLowerCase().compareTo(
                              b.name.toLowerCase(),
                            ),
                          );
                        return Column(
                          children: sorted.map((project) {
                            final isSelected = selectedPath == project.path;
                            return _FilterProjectTile(
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
              ),
            ],
          );
        },
      );
    },
  );
}

// Modern filter tile widget
class _FilterProjectTile extends StatelessWidget {
  const _FilterProjectTile({
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
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          color: isSelected
              ? ocTheme.primary.withValues(alpha: 0.1)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
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
                    const SizedBox(height: 2),
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
              Icon(Icons.check_rounded, color: ocTheme.primary, size: 20),
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

// Session card with swipe-to-delete, long-press to rename, and status indicator
class _SessionCard extends StatelessWidget {
  const _SessionCard({
    required this.session,
    required this.onTap,
    this.status,
    this.onDelete,
    this.onRename,
    this.isOfflineMode = false,
    this.childCount = 0,
    this.isExpanded = false,
    this.onToggleExpand,
    this.activeChildCount = 0,
  });

  final SessionSummary session;
  final SessionStatus? status;
  final VoidCallback onTap;
  final VoidCallback? onDelete;
  final VoidCallback? onRename;
  final bool isOfflineMode;

  /// Number of background task children
  final int childCount;

  /// Whether children are expanded
  final bool isExpanded;

  /// Callback to toggle expand/collapse
  final VoidCallback? onToggleExpand;

  /// Number of active (busy/retry) child sessions
  final int activeChildCount;

  bool get isActive => status != null && (status!.isBusy || status!.isRetry);

  bool get hasChildren => childCount > 0;

  String _getProjectName() {
    return session.directory.split('/').where((item) => item.isNotEmpty).last;
  }

  // Generate two colors for gradient based on session ID hash
  List<Color> _getGradientColors(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final hash = session.id.hashCode;
    final colors = [
      ocTheme.primary,
      ocTheme.secondary,
      ocTheme.accent,
      ocTheme.success,
      ocTheme.info,
    ];
    final c1 = colors[hash.abs() % colors.length];
    final c2 = colors[(hash.abs() + 2) % colors.length];
    return [c1, c2];
  }

  String _formatDate(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp * 1000);
    final now = DateTime.now();
    final diff = now.difference(date);

    if (diff.inMinutes < 1) {
      return 'Just now';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m ago';
    } else if (diff.inHours < 24) {
      return '${diff.inHours}h ago';
    } else if (diff.inDays < 7) {
      return '${diff.inDays}d ago';
    } else {
      return '${date.day}/${date.month}/${date.year}';
    }
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final gradientColors = _getGradientColors(context);

    // Base card widget - fixed height for uniformity
    Widget card = GestureDetector(
      onTap: onTap,
      // Feature 5: Long press to rename (disabled in offline mode)
      onLongPress: onRename,
      child: Container(
        height: 76,
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isActive
                ? ocTheme.info.withValues(alpha: 0.5)
                : ocTheme.borderSubtle,
          ),
        ),
        child: Row(
          children: [
            // Modern gradient orb with optional activity indicator
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [
                        gradientColors[0].withValues(alpha: 0.8),
                        gradientColors[1].withValues(alpha: 0.6),
                      ],
                    ),
                  ),
                  child: Center(
                    child: Text(
                      '>_',
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.9),
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        fontFamily: 'monospace',
                      ),
                    ),
                  ),
                ),
                // Active session indicator - pulsing dot
                if (isActive)
                  Positioned(
                    top: -2,
                    right: -2,
                    child: _PulsingDot(
                      color: status!.isRetry ? ocTheme.warning : ocTheme.info,
                    ),
                  ),
              ],
            ),
            const SizedBox(width: 12),
            // Session info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          session.title,
                          style: TextStyle(
                            color: ocTheme.text,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            height: 1.2,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      // Status badge
                      if (isActive) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color:
                                (status!.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info)
                                    .withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            status!.isRetry ? 'Retry' : 'Active',
                            style: TextStyle(
                              color: status!.isRetry
                                  ? ocTheme.warning
                                  : ocTheme.info,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '${_getProjectName()} · ${_formatDate(session.time.updated)}',
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            // Background tasks expand button
            if (hasChildren)
              GestureDetector(
                onTap: onToggleExpand,
                behavior: HitTestBehavior.opaque,
                child: Container(
                  padding: const EdgeInsets.all(4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // Badge with count
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: activeChildCount > 0
                              ? ocTheme.info.withValues(alpha: 0.15)
                              : ocTheme.textMuted.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.account_tree_rounded,
                              size: 10,
                              color: activeChildCount > 0
                                  ? ocTheme.info
                                  : ocTheme.textMuted,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              '$childCount',
                              style: TextStyle(
                                color: activeChildCount > 0
                                    ? ocTheme.info
                                    : ocTheme.textMuted,
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 4),
                      AnimatedRotation(
                        turns: isExpanded ? 0.25 : 0,
                        duration: const Duration(milliseconds: 200),
                        child: Icon(
                          Icons.chevron_right_rounded,
                          color: ocTheme.textMuted.withValues(alpha: 0.6),
                          size: 18,
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else
              // Chevron (no children)
              Icon(
                Icons.chevron_right_rounded,
                color: ocTheme.textMuted.withValues(alpha: 0.4),
                size: 20,
              ),
          ],
        ),
      ),
    );

    // Feature 4: Wrap with Dismissible for swipe-to-delete (only when online)
    if (onDelete != null) {
      card = Dismissible(
        key: Key(session.id),
        direction: DismissDirection.endToStart,
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          decoration: BoxDecoration(
            color: ocTheme.error,
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Icon(
            Icons.delete_outline_rounded,
            color: Colors.white,
            size: 24,
          ),
        ),
        confirmDismiss: (_) async {
          onDelete!();
          return false; // Let the parent handle actual deletion
        },
        child: card,
      );
    }

    return card;
  }
}

/// Card for child (background task) sessions - compact design with indent
class _ChildSessionCard extends StatelessWidget {
  const _ChildSessionCard({
    required this.session,
    required this.onTap,
    this.status,
    this.isOfflineMode = false,
  });

  final SessionSummary session;
  final SessionStatus? status;
  final VoidCallback onTap;
  final bool isOfflineMode;

  bool get isActive => status != null && (status!.isBusy || status!.isRetry);

  String _formatDate(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp * 1000);
    final now = DateTime.now();
    final diff = now.difference(date);

    if (diff.inMinutes < 1) {
      return 'Just now';
    } else if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m ago';
    } else if (diff.inHours < 24) {
      return '${diff.inHours}h ago';
    } else if (diff.inDays < 7) {
      return '${diff.inDays}d ago';
    } else {
      return '${date.day}/${date.month}/${date.year}';
    }
  }

  /// Extract agent name from title like "Description (@agent subagent)"
  String? _extractAgentName() {
    final match = RegExp(r'\(@(\w+) subagent\)$').firstMatch(session.title);
    return match?.group(1);
  }

  /// Get title without the agent suffix
  String _getCleanTitle() {
    return session.title.replaceAll(RegExp(r'\s*\(@\w+ subagent\)$'), '');
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final agentName = _extractAgentName();
    final cleanTitle = _getCleanTitle();

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: ocTheme.backgroundElement.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: isActive
                ? ocTheme.info.withValues(alpha: 0.4)
                : ocTheme.borderSubtle.withValues(alpha: 0.5),
          ),
        ),
        child: Row(
          children: [
            // Indent line indicator
            Container(
              width: 2,
              height: 32,
              margin: const EdgeInsets.only(right: 10),
              decoration: BoxDecoration(
                color: isActive
                    ? ocTheme.info.withValues(alpha: 0.6)
                    : ocTheme.textMuted.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(1),
              ),
            ),
            // Agent icon
            Container(
              width: 28,
              height: 28,
              decoration: BoxDecoration(
                color: ocTheme.info.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Center(
                child: Icon(
                  Icons.auto_awesome_rounded,
                  size: 14,
                  color: ocTheme.info,
                ),
              ),
            ),
            const SizedBox(width: 10),
            // Session info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      if (agentName != null) ...[
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.info.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(3),
                          ),
                          child: Text(
                            '@$agentName',
                            style: TextStyle(
                              color: ocTheme.info,
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                      ],
                      if (isActive)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color:
                                (status!.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info)
                                    .withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(3),
                          ),
                          child: Text(
                            status!.isRetry ? 'Retry' : 'Running',
                            style: TextStyle(
                              color: status!.isRetry
                                  ? ocTheme.warning
                                  : ocTheme.info,
                              fontSize: 9,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    cleanTitle,
                    style: TextStyle(
                      color: ocTheme.text.withValues(alpha: 0.9),
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _formatDate(session.time.updated),
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 10),
                  ),
                ],
              ),
            ),
            // Chevron
            Icon(
              Icons.chevron_right_rounded,
              color: ocTheme.textMuted.withValues(alpha: 0.4),
              size: 16,
            ),
          ],
        ),
      ),
    );
  }
}

/// Pulsing dot indicator for active sessions
class _PulsingDot extends StatefulWidget {
  const _PulsingDot({required this.color});

  final Color color;

  @override
  State<_PulsingDot> createState() => _PulsingDotState();
}

class _PulsingDotState extends State<_PulsingDot>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat(reverse: true);
    _animation = Tween<double>(
      begin: 0.4,
      end: 1.0,
    ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Container(
          width: 10,
          height: 10,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: widget.color,
            boxShadow: [
              BoxShadow(
                color: widget.color.withValues(alpha: _animation.value * 0.6),
                blurRadius: 6,
                spreadRadius: 1,
              ),
            ],
          ),
        );
      },
    );
  }
}

// Empty state
class _EmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: ocTheme.primary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.history_rounded,
              size: 48,
              color: ocTheme.primary,
            ),
          ),
          const SizedBox(height: 24),
          Text(
            'No sessions yet',
            style: TextStyle(
              color: ocTheme.text,
              fontSize: 20,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
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

/// Skeleton loading card that mimics the session card layout.
/// Shows shimmer animation while data is loading.
class _SkeletonSessionCard extends StatefulWidget {
  @override
  State<_SkeletonSessionCard> createState() => _SkeletonSessionCardState();
}

class _SkeletonSessionCardState extends State<_SkeletonSessionCard>
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
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: ocTheme.borderSubtle),
          ),
          child: Row(
            children: [
              // Skeleton orb
              _SkeletonBox(
                width: 44,
                height: 44,
                borderRadius: 12,
                shimmerValue: _animation.value,
              ),
              const SizedBox(width: 12),
              // Skeleton text lines
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _SkeletonBox(
                      width: double.infinity,
                      height: 14,
                      borderRadius: 4,
                      shimmerValue: _animation.value,
                      maxWidthFraction: 0.7,
                    ),
                    const SizedBox(height: 8),
                    _SkeletonBox(
                      width: double.infinity,
                      height: 12,
                      borderRadius: 4,
                      shimmerValue: _animation.value,
                      maxWidthFraction: 0.5,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              // Skeleton chevron
              _SkeletonBox(
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

/// Delayed skeleton list: only shows skeleton after 100ms delay.
/// Prevents flash when data loads quickly from cache.
class _DelayedSkeletonList extends StatefulWidget {
  @override
  State<_DelayedSkeletonList> createState() => _DelayedSkeletonListState();
}

class _DelayedSkeletonListState extends State<_DelayedSkeletonList> {
  bool _showSkeleton = false;

  @override
  void initState() {
    super.initState();
    Future.delayed(const Duration(milliseconds: 100), () {
      if (mounted) {
        setState(() => _showSkeleton = true);
      }
    });
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
          (index) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _SkeletonSessionCard(),
          ),
        ),
      ),
    );
  }
}

/// A shimmer box widget used for skeleton loading.
class _SkeletonBox extends StatelessWidget {
  const _SkeletonBox({
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
