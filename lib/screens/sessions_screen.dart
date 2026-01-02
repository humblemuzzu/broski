import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../models/claude_code.dart';
import '../models/highlight_color.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../providers/agent_type_provider.dart';
import '../providers/chat_provider.dart';
import '../providers/claude_code_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/highlights_provider.dart';
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

  void _showSessionsTitleFiltersSheet(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        final height = MediaQuery.of(ctx).size.height * 0.75;
        return SafeArea(
          child: Container(
            height: height,
            decoration: BoxDecoration(
              color: ocTheme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(20),
              ),
            ),
            child: Consumer(
              builder: (context, ref, _) {
                final filters = ref.watch(sessionsTitleExcludeFiltersProvider);
                final notifier = ref.read(
                  sessionsTitleExcludeFiltersProvider.notifier,
                );

                return Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Title filters',
                              style: TextStyle(
                                color: ocTheme.text,
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(ctx),
                            icon: Icon(
                              Icons.close_rounded,
                              color: ocTheme.textMuted,
                            ),
                            tooltip: 'Close',
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Hide sessions whose titles match any filter. Use `/regex/` for regex, otherwise it’s a case-insensitive substring match.',
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: controller,
                              decoration: InputDecoration(
                                hintText: 'e.g. test, tmp, /wip.*/',
                                hintStyle: TextStyle(color: ocTheme.textMuted),
                                filled: true,
                                fillColor: ocTheme.backgroundElement,
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide(
                                    color: ocTheme.borderSubtle,
                                  ),
                                ),
                                enabledBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide(
                                    color: ocTheme.borderSubtle,
                                  ),
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide(
                                    color: ocTheme.primary,
                                  ),
                                ),
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 10,
                                ),
                              ),
                              style: TextStyle(color: ocTheme.text),
                              textInputAction: TextInputAction.done,
                              onSubmitted: (value) async {
                                await notifier.add(value);
                                controller.clear();
                              },
                            ),
                          ),
                          const SizedBox(width: 10),
                          ElevatedButton(
                            onPressed: () async {
                              await notifier.add(controller.text);
                              controller.clear();
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: ocTheme.primary,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 12,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            child: const Text('Add'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      if (filters.isNotEmpty)
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                            onPressed: () => notifier.clear(),
                            child: Text(
                              'Clear all',
                              style: TextStyle(color: ocTheme.error),
                            ),
                          ),
                        ),
                      Expanded(
                        child: filters.isEmpty
                            ? Center(
                                child: Text(
                                  'No filters yet',
                                  style: TextStyle(color: ocTheme.textMuted),
                                ),
                              )
                            : ListView.separated(
                                itemCount: filters.length,
                                separatorBuilder: (_, __) =>
                                    Divider(color: ocTheme.borderSubtle),
                                itemBuilder: (context, index) {
                                  final f = filters[index];
                                  return ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    leading: Icon(
                                      f.startsWith('/') && f.endsWith('/')
                                          ? Icons.code_rounded
                                          : Icons.text_fields_rounded,
                                      color: ocTheme.textMuted,
                                    ),
                                    title: Text(
                                      f,
                                      style: TextStyle(color: ocTheme.text),
                                    ),
                                    trailing: IconButton(
                                      onPressed: () => notifier.removeAt(index),
                                      icon: Icon(
                                        Icons.delete_outline_rounded,
                                        color: ocTheme.error,
                                      ),
                                      tooltip: 'Remove',
                                    ),
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        );
      },
    ).whenComplete(controller.dispose);
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
    final agentType = ref.watch(agentTypeProvider);

    if (agentType == AgentType.claudeCode) {
      return _ClaudeCodeSessionsView(onRefresh: _refresh);
    }

    final connection = ref.watch(connectionProvider);
    final theme = Theme.of(context);
    final filterProjectPath = ref.watch(sessionsFilterProjectPathProvider);
    final projectsAsync = ref.watch(projectsForSessionsProvider);
    final sessionsAsync = ref.watch(sessionsListProvider);
    final sessionStatuses = ref.watch(globalSessionStatusProvider);

    return Scaffold(
      backgroundColor: Colors.transparent,
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
                    final titleFilterCount = ref
                        .watch(sessionsTitleExcludeFiltersProvider)
                        .length;

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
                      titleFilterCount: titleFilterCount,
                      onTitleFiltersTap: () =>
                          _showSessionsTitleFiltersSheet(context),
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

                  // Get highlighted sessions
                  final highlights = ref.watch(highlightsProvider);
                  final highlightColor = highlights.color;

                  // Filter to only root sessions (background tasks are nested)
                  final rootSessions = sessions
                      .where((s) => s.isRootSession)
                      .toList();

                  // Get highlighted sessions for the section
                  final highlightedSessions = rootSessions
                      .where((s) => highlights.isSessionHighlighted(s.id))
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

                  // Build items using grouped sessions (only for regular sessions)
                  final regularGrouped = groupedSessions
                      .where(
                        (g) => !highlights.isSessionHighlighted(g.session.id),
                      )
                      .toList();
                  final items = _buildGroupedListItems(
                    groupedSessions: regularGrouped,
                    projectsByPath: projectsByPath,
                    grouped: filterProjectPath == null,
                    showBackgroundTasks: showBgTasks,
                    expandedSessions: expandedSessions,
                  );

                  return [
                    // Highlighted Sessions Section
                    if (highlightedSessions.isNotEmpty)
                      SliverToBoxAdapter(
                        child: _HighlightedSessionsSection(
                          sessions: highlightedSessions,
                          sessionStatuses: sessionStatuses,
                          highlightColor: highlightColor,
                          isOfflineMode: connection.isOfflineMode,
                          onTap: _openSession,
                          onLongPress: connection.isOfflineMode
                              ? null
                              : _showSessionOptions,
                          onDelete: connection.isOfflineMode
                              ? null
                              : _deleteSession,
                        ),
                      ),
                    // Regular Sessions
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
                                onLongPress: connection.isOfflineMode
                                    ? null
                                    : () => _showSessionOptions(session),
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

  // Toggle highlight for a session
  void _toggleHighlight(String sessionId) {
    ref.read(highlightsProvider.notifier).toggleSession(sessionId);
  }

  // Show options menu (highlight + rename)
  Future<void> _showSessionOptions(SessionSummary session) async {
    final highlights = ref.read(highlightsProvider);
    final isHighlighted = highlights.isSessionHighlighted(session.id);
    final ocTheme = OpenCodeTheme.of(context);
    final highlightColor = highlights.color;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: ocTheme.backgroundPanel,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Drag handle
                Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: ocTheme.textMuted.withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 16),
                // Session title
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Text(
                    session.title,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(height: 16),
                // Options
                ListTile(
                  leading: Icon(
                    isHighlighted
                        ? Icons.star_rounded
                        : Icons.star_border_rounded,
                    color: isHighlighted
                        ? highlightColor.forBrightness(
                            Theme.of(context).brightness,
                            themePrimary: ocTheme.primary,
                          )
                        : ocTheme.textMuted,
                  ),
                  title: Text(
                    isHighlighted ? 'Remove Highlight' : 'Highlight',
                    style: TextStyle(color: ocTheme.text),
                  ),
                  onTap: () {
                    Navigator.pop(context);
                    _toggleHighlight(session.id);
                  },
                ),
                ListTile(
                  leading: Icon(Icons.edit_rounded, color: ocTheme.textMuted),
                  title: Text('Rename', style: TextStyle(color: ocTheme.text)),
                  onTap: () {
                    Navigator.pop(context);
                    _showRenameDialog(session);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
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
    required this.titleFilterCount,
    required this.onTitleFiltersTap,
    required this.showBackgroundTasks,
    required this.onToggleBackgroundTasks,
    required this.backgroundTaskCount,
  });

  final BridgeConnectionState connection;
  final String? filterProjectPath;
  final AsyncValue<List<ProjectSummary>> projects;
  final ValueChanged<String?> onFilterChanged;
  final VoidCallback onRefresh;
  final int titleFilterCount;
  final VoidCallback onTitleFiltersTap;
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
              _TitleFiltersChip(
                count: titleFilterCount,
                onTap: onTitleFiltersTap,
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

class _TitleFiltersChip extends StatelessWidget {
  const _TitleFiltersChip({required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    final hasFilters = count > 0;
    final color = hasFilters ? ocTheme.warning : ocTheme.textMuted;

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: hasFilters
              ? ocTheme.warning.withValues(alpha: 0.15)
              : ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(
            color: hasFilters ? ocTheme.warning : ocTheme.borderSubtle,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.filter_alt_rounded, size: 14, color: color),
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

/// Section showing highlighted sessions at the top
class _HighlightedSessionsSection extends StatelessWidget {
  const _HighlightedSessionsSection({
    required this.sessions,
    required this.sessionStatuses,
    required this.highlightColor,
    required this.isOfflineMode,
    required this.onTap,
    this.onLongPress,
    this.onDelete,
  });

  final List<SessionSummary> sessions;
  final Map<String, SessionStatus> sessionStatuses;
  final HighlightColor highlightColor;
  final bool isOfflineMode;
  final void Function(SessionSummary) onTap;
  final void Function(SessionSummary)? onLongPress;
  final void Function(SessionSummary)? onDelete;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final color = highlightColor.forBrightness(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section header
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
            child: Row(
              children: [
                Icon(Icons.star_rounded, size: 14, color: color),
                const SizedBox(width: 6),
                Text(
                  'HIGHLIGHTED',
                  style: TextStyle(
                    color: color,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                  ),
                ),
              ],
            ),
          ),
          // Highlighted session cards
          ...sessions.map((session) {
            final status = sessionStatuses[session.id];
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _HighlightedSessionCard(
                session: session,
                status: status,
                highlightColor: highlightColor,
                isOfflineMode: isOfflineMode,
                onTap: () => onTap(session),
                onLongPress: onLongPress != null
                    ? () => onLongPress!(session)
                    : null,
                onDelete: onDelete != null ? () => onDelete!(session) : null,
              ),
            );
          }),
        ],
      ),
    );
  }
}

/// Highlighted session card with accent styling
class _HighlightedSessionCard extends StatelessWidget {
  const _HighlightedSessionCard({
    required this.session,
    required this.highlightColor,
    required this.onTap,
    this.status,
    this.isOfflineMode = false,
    this.onLongPress,
    this.onDelete,
  });

  final SessionSummary session;
  final SessionStatus? status;
  final HighlightColor highlightColor;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final VoidCallback? onDelete;
  final bool isOfflineMode;

  bool get isActive => status != null && (status!.isBusy || status!.isRetry);

  String _getProjectName() {
    return session.directory.split('/').where((item) => item.isNotEmpty).last;
  }

  String _getAvatarLetter() {
    if (session.title.isEmpty) return '?';
    final match = RegExp(r'[a-zA-Z0-9]').firstMatch(session.title);
    return match != null
        ? match.group(0)!.toUpperCase()
        : session.title[0].toUpperCase();
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
    final color = highlightColor.forBrightness(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    final bgColor = highlightColor.backgroundFor(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );

    Widget card = GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        height: 80,
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: isActive
                ? ocTheme.info.withValues(alpha: 0.5)
                : highlightColor.borderFor(
                    Theme.of(context).brightness,
                    themePrimary: ocTheme.primary,
                  ),
          ),
        ),
        child: Row(
          children: [
            // Left accent border
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: color,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(14),
                  bottomLeft: Radius.circular(14),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 13,
                  vertical: 14,
                ),
                child: Row(
                  children: [
                    // Avatar with status dot
                    Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(12),
                            color: ocTheme.backgroundElement,
                            border: Border.all(
                              color: ocTheme.borderSubtle,
                              width: 1,
                            ),
                          ),
                          child: Center(
                            child: Text(
                              _getAvatarLetter(),
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 18,
                                fontWeight: FontWeight.w600,
                                letterSpacing: -0.5,
                              ),
                            ),
                          ),
                        ),
                        Positioned(
                          bottom: -2,
                          left: -2,
                          child: Container(
                            width: 12,
                            height: 12,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: isActive
                                  ? (status!.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info)
                                  : ocTheme.textMuted.withValues(alpha: 0.4),
                              border: Border.all(color: bgColor, width: 2),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(width: 16),
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
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                    height: 1.4,
                                    letterSpacing: -0.2,
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
                          const SizedBox(height: 6),
                          Text(
                            '${_getProjectName()} · ${_formatDate(session.time.updated)}',
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 13,
                              height: 1.4,
                              letterSpacing: -0.1,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Star icon
                    Icon(Icons.star_rounded, color: color, size: 20),
                    const SizedBox(width: 4),
                    // Chevron
                    Icon(
                      Icons.chevron_right_rounded,
                      color: ocTheme.textMuted.withValues(alpha: 0.4),
                      size: 20,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );

    // Swipe to delete
    if (onDelete != null) {
      card = Dismissible(
        key: Key(session.id),
        direction: DismissDirection.endToStart,
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          decoration: BoxDecoration(
            color: ocTheme.error,
            borderRadius: BorderRadius.circular(14),
          ),
          child: const Icon(
            Icons.delete_outline_rounded,
            color: Colors.white,
            size: 24,
          ),
        ),
        confirmDismiss: (_) async {
          onDelete!();
          return false;
        },
        child: card,
      );
    }

    return card;
  }
}

// Session card with swipe-to-delete, long-press for options, and status indicator
class _SessionCard extends StatelessWidget {
  const _SessionCard({
    required this.session,
    required this.onTap,
    this.status,
    this.onDelete,
    this.onLongPress,
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
  final VoidCallback? onLongPress;
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

  // Get first letter of session title for avatar
  String _getAvatarLetter() {
    if (session.title.isEmpty) return '?';
    // Get first alphanumeric character
    final match = RegExp(r'[a-zA-Z0-9]').firstMatch(session.title);
    return match != null
        ? match.group(0)!.toUpperCase()
        : session.title[0].toUpperCase();
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

    // Base card widget - fixed height for uniformity
    Widget card = GestureDetector(
      onTap: onTap,
      // Long press for options (highlight, rename)
      onLongPress: onLongPress,
      child: Container(
        height: 80,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
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
            // Modern letter avatar with status dot
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    color: ocTheme.backgroundElement,
                    border: Border.all(color: ocTheme.borderSubtle, width: 1),
                  ),
                  child: Center(
                    child: Text(
                      _getAvatarLetter(),
                      style: TextStyle(
                        color: ocTheme.textMuted,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.5,
                      ),
                    ),
                  ),
                ),
                // Status dot at bottom-left corner
                Positioned(
                  bottom: -2,
                  left: -2,
                  child: Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: isActive
                          ? (status!.isRetry ? ocTheme.warning : ocTheme.info)
                          : ocTheme.textMuted.withValues(alpha: 0.4),
                      border: Border.all(
                        color: ocTheme.backgroundPanel,
                        width: 2,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 16),
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
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            height: 1.4,
                            letterSpacing: -0.2,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      // Forked indicator
                      if (session.isForkedSession) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.accent.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Icon(
                                Icons.fork_right,
                                size: 10,
                                color: ocTheme.accent,
                              ),
                              const SizedBox(width: 3),
                              Text(
                                'Forked',
                                style: TextStyle(
                                  color: ocTheme.accent,
                                  fontSize: 10,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
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
                  const SizedBox(height: 6),
                  Text(
                    '${_getProjectName()} · ${_formatDate(session.time.updated)}',
                    style: TextStyle(
                      color: ocTheme.textMuted,
                      fontSize: 13,
                      height: 1.4,
                      letterSpacing: -0.1,
                    ),
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

// ============================================================================
// Claude Code Sessions View
// ============================================================================

class _CCActiveSessionsSection extends ConsumerWidget {
  const _CCActiveSessionsSection({this.onSessionTap});

  final void Function(ClaudeCodeSession session)? onSessionTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    final sessionsAsync = ref.watch(ccSessionsProvider);
    final sessions = sessionsAsync.valueOrNull ?? const <ClaudeCodeSession>[];

    final activeSessions = sessions.where((session) {
      final status = sessionStatuses[session.id];
      return status != null && (status.isBusy || status.isRetry);
    }).toList();

    if (activeSessions.isEmpty) return const SizedBox.shrink();

    final ocTheme = OpenCodeTheme.of(context);

    return Container(
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ocTheme.info.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.play_circle_rounded, color: ocTheme.info, size: 20),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Running',
                      style: TextStyle(
                        color: ocTheme.text,
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    Text(
                      '${activeSessions.length} session${activeSessions.length > 1 ? 's' : ''} active',
                      style: TextStyle(color: ocTheme.info, fontSize: 12),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...activeSessions.map((session) {
            final status = sessionStatuses[session.id];
            final isRetry = status?.isRetry ?? false;
            final statusColor = isRetry ? ocTheme.warning : ocTheme.info;
            final parts = session.cwd
                .split('/')
                .where((p) => p.isNotEmpty)
                .toList();
            final projectName = parts.isNotEmpty ? parts.last : null;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: GestureDetector(
                onTap: onSessionTap != null
                    ? () => onSessionTap!(session)
                    : null,
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: ocTheme.backgroundElement,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(
                      color: statusColor.withValues(alpha: 0.3),
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: statusColor,
                          shape: BoxShape.circle,
                          boxShadow: [
                            BoxShadow(
                              color: statusColor.withValues(alpha: 0.5),
                              blurRadius: 4,
                              spreadRadius: 1,
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              session.displayTitle,
                              style: TextStyle(
                                color: ocTheme.text,
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                if (projectName != null)
                                  Text(
                                    projectName,
                                    style: TextStyle(
                                      color: ocTheme.textMuted,
                                      fontSize: 11,
                                    ),
                                  ),
                                if (isRetry) ...[
                                  const SizedBox(width: 8),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                      vertical: 2,
                                    ),
                                    decoration: BoxDecoration(
                                      color: ocTheme.warning.withValues(
                                        alpha: 0.15,
                                      ),
                                      borderRadius: BorderRadius.circular(4),
                                    ),
                                    child: Text(
                                      'Retrying',
                                      style: TextStyle(
                                        color: ocTheme.warning,
                                        fontSize: 9,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ],
                        ),
                      ),
                      Icon(
                        Icons.chevron_right_rounded,
                        color: ocTheme.textMuted.withValues(alpha: 0.5),
                        size: 18,
                      ),
                    ],
                  ),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }
}

class _ClaudeCodeSessionsView extends ConsumerStatefulWidget {
  const _ClaudeCodeSessionsView({required this.onRefresh});

  final Future<void> Function() onRefresh;

  @override
  ConsumerState<_ClaudeCodeSessionsView> createState() =>
      _ClaudeCodeSessionsViewState();
}

class _ClaudeCodeSessionsViewState
    extends ConsumerState<_ClaudeCodeSessionsView> {
  @override
  void initState() {
    super.initState();
    // Load sessions on init
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final cwd = ref.read(ccSessionsFilterCwdProvider);
      ref.read(ccSessionsProvider.notifier).load(cwd: cwd);
    });
  }

  Future<void> _refresh() async {
    final cwd = ref.read(ccSessionsFilterCwdProvider);
    await ref.read(ccSessionsProvider.notifier).refresh(cwd: cwd);
    ref.invalidate(ccProjectsForSessionsProvider);
    await widget.onRefresh();
  }

  void _showTitleFiltersSheet(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        final height = MediaQuery.of(ctx).size.height * 0.75;
        return SafeArea(
          child: Container(
            height: height,
            decoration: BoxDecoration(
              color: ocTheme.backgroundPanel,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(20),
              ),
            ),
            child: Consumer(
              builder: (context, ref, _) {
                final filters = ref.watch(sessionsTitleExcludeFiltersProvider);
                final notifier = ref.read(
                  sessionsTitleExcludeFiltersProvider.notifier,
                );

                return Padding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Title filters',
                              style: TextStyle(
                                color: ocTheme.text,
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(ctx),
                            icon: Icon(
                              Icons.close_rounded,
                              color: ocTheme.textMuted,
                            ),
                            tooltip: 'Close',
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Hide sessions whose titles match any filter. Use `/regex/` for regex, otherwise it’s a case-insensitive substring match.',
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 13,
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: controller,
                              decoration: InputDecoration(
                                hintText: 'e.g. test, tmp, /wip.*/',
                                hintStyle: TextStyle(color: ocTheme.textMuted),
                                filled: true,
                                fillColor: ocTheme.backgroundElement,
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide(
                                    color: ocTheme.borderSubtle,
                                  ),
                                ),
                                enabledBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide(
                                    color: ocTheme.borderSubtle,
                                  ),
                                ),
                                focusedBorder: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  borderSide: BorderSide(
                                    color: ocTheme.primary,
                                  ),
                                ),
                                contentPadding: const EdgeInsets.symmetric(
                                  horizontal: 12,
                                  vertical: 10,
                                ),
                              ),
                              style: TextStyle(color: ocTheme.text),
                              textInputAction: TextInputAction.done,
                              onSubmitted: (value) async {
                                await notifier.add(value);
                                controller.clear();
                              },
                            ),
                          ),
                          const SizedBox(width: 10),
                          ElevatedButton(
                            onPressed: () async {
                              await notifier.add(controller.text);
                              controller.clear();
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: ocTheme.primary,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 12,
                              ),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                            ),
                            child: const Text('Add'),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      if (filters.isNotEmpty)
                        Align(
                          alignment: Alignment.centerRight,
                          child: TextButton(
                            onPressed: () => notifier.clear(),
                            child: Text(
                              'Clear all',
                              style: TextStyle(color: ocTheme.error),
                            ),
                          ),
                        ),
                      Expanded(
                        child: filters.isEmpty
                            ? Center(
                                child: Text(
                                  'No filters yet',
                                  style: TextStyle(color: ocTheme.textMuted),
                                ),
                              )
                            : ListView.separated(
                                itemCount: filters.length,
                                separatorBuilder: (_, __) =>
                                    Divider(color: ocTheme.borderSubtle),
                                itemBuilder: (context, index) {
                                  final f = filters[index];
                                  return ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    leading: Icon(
                                      f.startsWith('/') && f.endsWith('/')
                                          ? Icons.code_rounded
                                          : Icons.text_fields_rounded,
                                      color: ocTheme.textMuted,
                                    ),
                                    title: Text(
                                      f,
                                      style: TextStyle(color: ocTheme.text),
                                    ),
                                    trailing: IconButton(
                                      onPressed: () => notifier.removeAt(index),
                                      icon: Icon(
                                        Icons.delete_outline_rounded,
                                        color: ocTheme.error,
                                      ),
                                      tooltip: 'Remove',
                                    ),
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
        );
      },
    ).whenComplete(controller.dispose);
  }

  Future<void> _deleteSession(ClaudeCodeSession session) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Delete Session?'),
        content: Text(
          'Are you sure you want to delete "${session.displayTitle}"? This action cannot be undone.',
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

    final success = await ref
        .read(ccSessionsProvider.notifier)
        .deleteSession(session.id, cwd: session.cwd);

    if (!mounted) return;

    final ocTheme = OpenCodeTheme.of(context);
    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Session deleted'),
          backgroundColor: ocTheme.backgroundPanel,
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Failed to delete session'),
          backgroundColor: ocTheme.error,
        ),
      );
    }
  }

  void _openSession(ClaudeCodeSession session) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen.claudeCode(ccSession: session),
      ),
    );
  }

  // Toggle highlight for a CC session
  void _toggleHighlight(String sessionId) {
    ref.read(highlightsProvider.notifier).toggleSession(sessionId);
  }

  // Show options menu (highlight + delete)
  Future<void> _showSessionOptions(ClaudeCodeSession session) async {
    final highlights = ref.read(highlightsProvider);
    final isHighlighted = highlights.isSessionHighlighted(session.id);
    final ocTheme = OpenCodeTheme.of(context);
    final highlightColor = highlights.color;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: ocTheme.backgroundPanel,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // Drag handle
                Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: ocTheme.textMuted.withValues(alpha: 0.3),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(height: 16),
                // Session title
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: Text(
                    session.displayTitle,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(height: 16),
                // Options
                ListTile(
                  leading: Icon(
                    isHighlighted
                        ? Icons.star_rounded
                        : Icons.star_border_rounded,
                    color: isHighlighted
                        ? highlightColor.forBrightness(
                            Theme.of(context).brightness,
                            themePrimary: ocTheme.primary,
                          )
                        : ocTheme.textMuted,
                  ),
                  title: Text(
                    isHighlighted ? 'Remove Highlight' : 'Highlight',
                    style: TextStyle(color: ocTheme.text),
                  ),
                  onTap: () {
                    Navigator.pop(context);
                    _toggleHighlight(session.id);
                  },
                ),
                ListTile(
                  leading: Icon(
                    Icons.delete_outline_rounded,
                    color: ocTheme.error,
                  ),
                  title: Text('Delete', style: TextStyle(color: ocTheme.error)),
                  onTap: () {
                    Navigator.pop(context);
                    _deleteSession(session);
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final sessionsAsync = ref.watch(ccSessionsProvider);
    final filterCwd = ref.watch(ccSessionsFilterCwdProvider);
    final projectsAsync = ref.watch(ccProjectsForSessionsProvider);
    final ocTheme = OpenCodeTheme.of(context);
    final highlights = ref.watch(highlightsProvider);
    final highlightColor = highlights.color;
    final titleFilterCount = ref
        .watch(sessionsTitleExcludeFiltersProvider)
        .length;
    final filterLabel = _filterLabel(
      selectedPath: filterCwd,
      projects: projectsAsync,
    );
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _refresh,
          color: ocTheme.primary,
          backgroundColor: ocTheme.backgroundPanel,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              // Active sessions (busy/retry) - parity with OpenCode
              SliverToBoxAdapter(
                child: _CCActiveSessionsSection(onSessionTap: _openSession),
              ),
              // Header
              SliverToBoxAdapter(
                child: Padding(
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
                            onPressed: _refresh,
                            icon: Icon(
                              Icons.refresh_rounded,
                              color: ocTheme.textMuted,
                            ),
                            tooltip: 'Refresh',
                          ),
                          // Claude Code badge
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.accent.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  Icons.terminal_rounded,
                                  size: 14,
                                  color: ocTheme.accent,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  'Claude Code',
                                  style: TextStyle(
                                    color: ocTheme.accent,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Claude Code sessions from ~/.claude',
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
                              selectedPath: filterCwd,
                              projects: projectsAsync,
                              onSelected: (path) {
                                ref
                                        .read(
                                          ccSessionsFilterCwdProvider.notifier,
                                        )
                                        .state =
                                    path;
                                ref
                                    .read(ccSessionsProvider.notifier)
                                    .load(cwd: path);
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          _TitleFiltersChip(
                            count: titleFilterCount,
                            onTap: () => _showTitleFiltersSheet(context),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              // Sessions list
              ...sessionsAsync.when(
                loading: () => [
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
                            color: ocTheme.error,
                            size: 48,
                          ),
                          const SizedBox(height: 16),
                          Text(
                            'Failed to load sessions',
                            style: TextStyle(
                              color: ocTheme.text,
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
                                color: ocTheme.textMuted,
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
                    return [SliverFillRemaining(child: _CCEmptyState())];
                  }

                  // Sort by updatedAt descending
                  final titleFilters = ref.watch(
                    sessionsTitleExcludeFiltersProvider,
                  );
                  final sorted =
                      sessions
                          .where(
                            (s) => titleFilters.isEmpty
                                ? true
                                : !sessionTitleMatchesExcludeFilters(
                                    s.displayTitle,
                                    titleFilters,
                                  ),
                          )
                          .toList()
                        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

                  // Separate highlighted and regular sessions
                  final highlightedSessions = sorted
                      .where((s) => highlights.isSessionHighlighted(s.id))
                      .toList();
                  final regularSessions = sorted
                      .where((s) => !highlights.isSessionHighlighted(s.id))
                      .toList();

                  return [
                    // Highlighted Sessions Section
                    if (highlightedSessions.isNotEmpty)
                      SliverToBoxAdapter(
                        child: _CCHighlightedSessionsSection(
                          sessions: highlightedSessions,
                          highlightColor: highlightColor,
                          onTap: _openSession,
                          onLongPress: _showSessionOptions,
                          onDelete: _deleteSession,
                        ),
                      ),
                    // Regular Sessions
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate((context, index) {
                          final session = regularSessions[index];
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: _CCSessionCard(
                              session: session,
                              onTap: () => _openSession(session),
                              onLongPress: () => _showSessionOptions(session),
                              onDelete: () => _deleteSession(session),
                            ),
                          );
                        }, childCount: regularSessions.length),
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
}

/// Section showing highlighted Claude Code sessions at the top
class _CCHighlightedSessionsSection extends StatelessWidget {
  const _CCHighlightedSessionsSection({
    required this.sessions,
    required this.highlightColor,
    required this.onTap,
    required this.onLongPress,
    required this.onDelete,
  });

  final List<ClaudeCodeSession> sessions;
  final HighlightColor highlightColor;
  final void Function(ClaudeCodeSession) onTap;
  final void Function(ClaudeCodeSession) onLongPress;
  final void Function(ClaudeCodeSession) onDelete;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final color = highlightColor.forBrightness(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section header
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 4, 10),
            child: Row(
              children: [
                Icon(Icons.star_rounded, size: 14, color: color),
                const SizedBox(width: 6),
                Text(
                  'HIGHLIGHTED',
                  style: TextStyle(
                    color: color,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                  ),
                ),
              ],
            ),
          ),
          // Highlighted session cards
          ...sessions.map((session) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _CCHighlightedSessionCard(
                session: session,
                highlightColor: highlightColor,
                onTap: () => onTap(session),
                onLongPress: () => onLongPress(session),
                onDelete: () => onDelete(session),
              ),
            );
          }),
        ],
      ),
    );
  }
}

/// Highlighted Claude Code session card with accent styling
class _CCHighlightedSessionCard extends StatelessWidget {
  const _CCHighlightedSessionCard({
    required this.session,
    required this.highlightColor,
    required this.onTap,
    required this.onLongPress,
    required this.onDelete,
  });

  final ClaudeCodeSession session;
  final HighlightColor highlightColor;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onDelete;

  String _getProjectName() {
    final parts = session.cwd.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  String _formatDate(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
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

  String _getAvatarLetter() {
    final title = session.displayTitle;
    if (title.isEmpty) return '?';
    final match = RegExp(r'[a-zA-Z0-9]').firstMatch(title);
    return match != null
        ? match.group(0)!.toUpperCase()
        : title[0].toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final color = highlightColor.forBrightness(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    final bgColor = highlightColor.backgroundFor(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );

    Widget card = GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        height: 80,
        decoration: BoxDecoration(
          color: bgColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: highlightColor.borderFor(
              Theme.of(context).brightness,
              themePrimary: ocTheme.primary,
            ),
          ),
        ),
        child: Row(
          children: [
            // Left accent border
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: color,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(14),
                  bottomLeft: Radius.circular(14),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 13,
                  vertical: 14,
                ),
                child: Row(
                  children: [
                    // Avatar
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(12),
                        color: ocTheme.backgroundElement,
                        border: Border.all(
                          color: ocTheme.borderSubtle,
                          width: 1,
                        ),
                      ),
                      child: Center(
                        child: Text(
                          _getAvatarLetter(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                            letterSpacing: -0.5,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 16),
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
                                  session.displayTitle,
                                  style: TextStyle(
                                    color: ocTheme.text,
                                    fontSize: 15,
                                    fontWeight: FontWeight.w600,
                                    height: 1.4,
                                    letterSpacing: -0.2,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              // Model badge if available
                              if (session.model != null) ...[
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 6,
                                    vertical: 2,
                                  ),
                                  decoration: BoxDecoration(
                                    color: ocTheme.info.withValues(alpha: 0.15),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Text(
                                    session.model!.split('/').last,
                                    style: TextStyle(
                                      color: ocTheme.info,
                                      fontSize: 10,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '${_getProjectName()} · ${_formatDate(session.updatedAt)}',
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 13,
                              height: 1.4,
                              letterSpacing: -0.1,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    // Star icon
                    Icon(Icons.star_rounded, color: color, size: 20),
                    const SizedBox(width: 4),
                    // Chevron
                    Icon(
                      Icons.chevron_right_rounded,
                      color: ocTheme.textMuted.withValues(alpha: 0.4),
                      size: 20,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );

    // Swipe to delete
    return Dismissible(
      key: Key(session.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(
          color: ocTheme.error,
          borderRadius: BorderRadius.circular(14),
        ),
        child: const Icon(
          Icons.delete_outline_rounded,
          color: Colors.white,
          size: 24,
        ),
      ),
      confirmDismiss: (_) async {
        onDelete();
        return false;
      },
      child: card,
    );
  }
}

/// Claude Code session card
class _CCSessionCard extends StatelessWidget {
  const _CCSessionCard({
    required this.session,
    required this.onTap,
    required this.onDelete,
    this.onLongPress,
  });

  final ClaudeCodeSession session;
  final VoidCallback onTap;
  final VoidCallback onDelete;
  final VoidCallback? onLongPress;

  String _getProjectName() {
    final parts = session.cwd.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  String _formatDate(int timestamp) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestamp);
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

  // Get first letter of session title for avatar
  String _getAvatarLetter() {
    final title = session.displayTitle;
    if (title.isEmpty) return '?';
    // Get first alphanumeric character
    final match = RegExp(r'[a-zA-Z0-9]').firstMatch(title);
    return match != null
        ? match.group(0)!.toUpperCase()
        : title[0].toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    Widget card = GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        height: 80,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Row(
          children: [
            // Modern letter avatar with status dot (no active status for CC)
            Stack(
              clipBehavior: Clip.none,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    color: ocTheme.backgroundElement,
                    border: Border.all(color: ocTheme.borderSubtle, width: 1),
                  ),
                  child: Center(
                    child: Text(
                      _getAvatarLetter(),
                      style: TextStyle(
                        color: ocTheme.textMuted,
                        fontSize: 18,
                        fontWeight: FontWeight.w600,
                        letterSpacing: -0.5,
                      ),
                    ),
                  ),
                ),
                // Status dot at bottom-left corner (gray for idle)
                Positioned(
                  bottom: -2,
                  left: -2,
                  child: Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: ocTheme.textMuted.withValues(alpha: 0.4),
                      border: Border.all(
                        color: ocTheme.backgroundPanel,
                        width: 2,
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(width: 16),
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
                          session.displayTitle,
                          style: TextStyle(
                            color: ocTheme.text,
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            height: 1.4,
                            letterSpacing: -0.2,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      // Model badge if available
                      if (session.model != null) ...[
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.info.withValues(alpha: 0.15),
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            session.model!.split('/').last,
                            style: TextStyle(
                              color: ocTheme.info,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${_getProjectName()} · ${_formatDate(session.updatedAt)}',
                    style: TextStyle(
                      color: ocTheme.textMuted,
                      fontSize: 13,
                      height: 1.4,
                      letterSpacing: -0.1,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            // Chevron
            Icon(
              Icons.chevron_right_rounded,
              color: ocTheme.textMuted.withValues(alpha: 0.4),
              size: 20,
            ),
          ],
        ),
      ),
    );

    // Swipe to delete
    return Dismissible(
      key: Key(session.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: 20),
        decoration: BoxDecoration(
          color: ocTheme.error,
          borderRadius: BorderRadius.circular(14),
        ),
        child: const Icon(
          Icons.delete_outline_rounded,
          color: Colors.white,
          size: 24,
        ),
      ),
      confirmDismiss: (_) async {
        onDelete();
        return false; // Let parent handle actual deletion
      },
      child: card,
    );
  }
}

/// Empty state for Claude Code sessions
class _CCEmptyState extends StatelessWidget {
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
              color: ocTheme.accent.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.terminal_rounded,
              size: 48,
              color: ocTheme.accent,
            ),
          ),
          const SizedBox(height: 24),
          Text(
            'No Claude Code sessions',
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
              'Sessions will appear here when you use Claude Code',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}

// ============================================================================
// Claude Code Chat Screen
// ============================================================================

class CCChatScreen extends ConsumerStatefulWidget {
  const CCChatScreen({super.key, required this.session});

  final ClaudeCodeSession session;

  @override
  ConsumerState<CCChatScreen> createState() => _CCChatScreenState();
}

class _CCChatScreenState extends ConsumerState<CCChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final FocusNode _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    // Initialize chat provider with this session
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(ccChatProvider.notifier).setSession(widget.session.id);
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  void _sendMessage() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;

    ref
        .read(ccChatProvider.notifier)
        .sendMessage(
          sessionId: widget.session.id,
          prompt: text,
          cwd: widget.session.cwd,
        );

    _controller.clear();
    _scrollToBottom();
  }

  void _abort() {
    ref.read(ccChatProvider.notifier).abort();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  String _getProjectName() {
    final parts = widget.session.cwd
        .split('/')
        .where((p) => p.isNotEmpty)
        .toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final chatState = ref.watch(ccChatProvider);

    // Build display messages from stream messages
    final displayMessages = _buildDisplayMessages(chatState.messages);

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.backgroundPanel,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_rounded, color: ocTheme.text),
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.session.displayTitle,
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              _getProjectName(),
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
          ],
        ),
        actions: [
          // Claude Code badge
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: ocTheme.accent.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.terminal_rounded, size: 12, color: ocTheme.accent),
                const SizedBox(width: 4),
                Text(
                  'CC',
                  style: TextStyle(
                    color: ocTheme.accent,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          // Messages list
          Expanded(
            child: displayMessages.isEmpty
                ? _CCChatEmptyState()
                : ListView.builder(
                    controller: _scrollController,
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 100),
                    itemCount: displayMessages.length,
                    itemBuilder: (context, index) {
                      final msg = displayMessages[index];
                      return _CCMessageBubble(
                        message: msg,
                        isStreaming:
                            chatState.isStreaming &&
                            index == displayMessages.length - 1,
                      );
                    },
                  ),
          ),
          // Input bar
          _CCInputBar(
            controller: _controller,
            focusNode: _focusNode,
            isStreaming: chatState.isStreaming,
            onSend: _sendMessage,
            onAbort: _abort,
          ),
        ],
      ),
    );
  }

  /// Convert stream messages to display messages
  List<_CCDisplayMessage> _buildDisplayMessages(
    List<ClaudeCodeStreamMessage> messages,
  ) {
    final display = <_CCDisplayMessage>[];
    String assistantText = '';
    final toolCalls = <CCToolCall>[];

    for (final msg in messages) {
      if (msg is CCSessionCreated) {
        // Session started - could show a system message if needed
        continue;
      }

      if (msg is CCAssistantMessage) {
        // Complete assistant message
        if (assistantText.isNotEmpty || toolCalls.isNotEmpty) {
          display.add(
            _CCDisplayMessage(
              role: 'assistant',
              text: assistantText,
              toolCalls: List.from(toolCalls),
            ),
          );
          assistantText = '';
          toolCalls.clear();
        }
        assistantText = msg.content;
      }

      if (msg is CCAssistantMessageDelta) {
        // Streaming delta - accumulate
        assistantText += msg.content;
      }

      if (msg is CCToolCall) {
        toolCalls.add(msg);
      }

      if (msg is CCToolResult) {
        // Tool completed - could update tool call status
      }

      if (msg is CCTokenUsage) {
        // End of turn - finalize assistant message
        if (assistantText.isNotEmpty || toolCalls.isNotEmpty) {
          display.add(
            _CCDisplayMessage(
              role: 'assistant',
              text: assistantText,
              toolCalls: List.from(toolCalls),
              tokenUsage: msg,
            ),
          );
          assistantText = '';
          toolCalls.clear();
        }
      }

      if (msg is CCError) {
        display.add(_CCDisplayMessage(role: 'error', text: msg.message));
      }
    }

    // Add any in-progress content
    if (assistantText.isNotEmpty || toolCalls.isNotEmpty) {
      display.add(
        _CCDisplayMessage(
          role: 'assistant',
          text: assistantText,
          toolCalls: List.from(toolCalls),
        ),
      );
    }

    return display;
  }
}

/// Display message model for CC chat
class _CCDisplayMessage {
  final String role; // 'user', 'assistant', 'error'
  final String text;
  final List<CCToolCall> toolCalls;
  final CCTokenUsage? tokenUsage;

  const _CCDisplayMessage({
    required this.role,
    this.text = '',
    this.toolCalls = const [],
    this.tokenUsage,
  });
}

/// Message bubble for CC chat
class _CCMessageBubble extends StatelessWidget {
  const _CCMessageBubble({required this.message, this.isStreaming = false});

  final _CCDisplayMessage message;
  final bool isStreaming;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    if (message.role == 'error') {
      return Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: ocTheme.error.withValues(alpha: 0.1),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: ocTheme.error.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            Icon(Icons.error_outline, color: ocTheme.error, size: 20),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                message.text,
                style: TextStyle(color: ocTheme.error, fontSize: 14),
              ),
            ),
          ],
        ),
      );
    }

    final isUser = message.role == 'user';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: isUser
            ? CrossAxisAlignment.end
            : CrossAxisAlignment.start,
        children: [
          // Text content
          if (message.text.isNotEmpty)
            Container(
              constraints: BoxConstraints(
                maxWidth: MediaQuery.of(context).size.width * 0.85,
              ),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: isUser ? ocTheme.primary : ocTheme.backgroundPanel,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(isUser ? 16 : 4),
                  bottomRight: Radius.circular(isUser ? 4 : 16),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    message.text,
                    style: TextStyle(
                      color: isUser ? Colors.white : ocTheme.text,
                      fontSize: 15,
                      height: 1.4,
                    ),
                  ),
                  if (isStreaming) ...[
                    const SizedBox(height: 4),
                    SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: ocTheme.textMuted,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          // Tool calls
          if (message.toolCalls.isNotEmpty) ...[
            const SizedBox(height: 8),
            ...message.toolCalls.map((tool) => _CCToolCallCard(tool: tool)),
          ],
          // Token usage
          if (message.tokenUsage != null) ...[
            const SizedBox(height: 4),
            Text(
              '${message.tokenUsage!.inputTokens ?? 0} in · ${message.tokenUsage!.outputTokens ?? 0} out',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 10),
            ),
          ],
        ],
      ),
    );
  }
}

/// Tool call card for CC chat
class _CCToolCallCard extends StatelessWidget {
  const _CCToolCallCard({required this.tool});

  final CCToolCall tool;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final isRunning = tool.status == 'running';

    return Container(
      margin: const EdgeInsets.only(bottom: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: ocTheme.backgroundElement,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: isRunning
                  ? ocTheme.info.withValues(alpha: 0.15)
                  : ocTheme.success.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(6),
            ),
            child: Center(
              child: isRunning
                  ? SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: ocTheme.info,
                      ),
                    )
                  : Icon(Icons.check_rounded, size: 14, color: ocTheme.success),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  tool.tool,
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                if (tool.input != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    _formatInput(tool.input),
                    style: TextStyle(
                      color: ocTheme.textMuted,
                      fontSize: 11,
                      fontFamily: 'monospace',
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatInput(dynamic input) {
    if (input == null) return '';
    if (input is String) return input;
    if (input is Map) {
      // Show first key-value or command
      if (input.containsKey('command')) return input['command'].toString();
      if (input.containsKey('path')) return input['path'].toString();
      if (input.containsKey('file_path')) return input['file_path'].toString();
      return input.entries.first.value.toString();
    }
    return input.toString();
  }
}

/// Empty state for CC chat
class _CCChatEmptyState extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.chat_bubble_outline_rounded,
            size: 48,
            color: ocTheme.textMuted.withValues(alpha: 0.5),
          ),
          const SizedBox(height: 16),
          Text(
            'Start a conversation',
            style: TextStyle(
              color: ocTheme.textMuted,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'Send a message to begin',
            style: TextStyle(
              color: ocTheme.textMuted.withValues(alpha: 0.7),
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }
}

/// Input bar for CC chat
class _CCInputBar extends StatelessWidget {
  const _CCInputBar({
    required this.controller,
    required this.focusNode,
    required this.isStreaming,
    required this.onSend,
    required this.onAbort,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final bool isStreaming;
  final VoidCallback onSend;
  final VoidCallback onAbort;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final bottomPadding = MediaQuery.of(context).viewInsets.bottom;

    return Container(
      padding: EdgeInsets.fromLTRB(16, 12, 16, 12 + bottomPadding),
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        border: Border(top: BorderSide(color: ocTheme.borderSubtle)),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: Container(
                decoration: BoxDecoration(
                  color: ocTheme.backgroundElement,
                  borderRadius: BorderRadius.circular(24),
                  border: Border.all(color: ocTheme.borderSubtle),
                ),
                child: TextField(
                  controller: controller,
                  focusNode: focusNode,
                  enabled: !isStreaming,
                  maxLines: 5,
                  minLines: 1,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => onSend(),
                  style: TextStyle(color: ocTheme.text, fontSize: 15),
                  decoration: InputDecoration(
                    hintText: isStreaming
                        ? 'Claude is thinking...'
                        : 'Message Claude Code',
                    hintStyle: TextStyle(color: ocTheme.textMuted),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 10,
                    ),
                    border: InputBorder.none,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            // Send or Abort button
            GestureDetector(
              onTap: isStreaming ? onAbort : onSend,
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: isStreaming ? ocTheme.error : ocTheme.primary,
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  isStreaming ? Icons.stop_rounded : Icons.arrow_upward_rounded,
                  color: Colors.white,
                  size: 22,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
