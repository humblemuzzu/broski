import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/models/permission_rule.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/session.dart';
import 'package:broski/models/worktree.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/permission_rules_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/providers/tool_settings_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/screens/sessions/cc_sessions_view.dart';
import 'package:broski/screens/sessions/cx_threads_view.dart';
import 'package:broski/screens/sessions/new_session_content.dart';
import 'package:broski/screens/sessions/pi_sessions_view.dart';
import 'package:broski/screens/sheets/session_options_sheet.dart';
import 'package:broski/screens/sheets/sessions_title_filters_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/background_session_widgets.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/sessions/archive_filter_chip.dart';
import 'package:broski/widgets/sessions/child_session_card.dart';
import 'package:broski/widgets/sessions/highlighted_card.dart';
import 'package:broski/widgets/sessions/session_card.dart';
import 'package:broski/widgets/sessions/session_helpers.dart';
import 'package:broski/widgets/sessions/sessions_search_bar.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class SessionsScreen extends ConsumerStatefulWidget {
  const SessionsScreen({super.key});
  @override
  ConsumerState<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends ConsumerState<SessionsScreen> {
  // Task 8: Session search (server-side via sessionsSearchQueryProvider)
  final _searchController = TextEditingController();
  Timer? _searchDebounce;
  @override
  void dispose() {
    _searchController.dispose();
    _searchDebounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 300), () {
      // Update the provider for server-side search
      ref.read(sessionsSearchQueryProvider.notifier).state = value.trim();
    });
  }

  Future<void> _refresh() async {
    ref.read(sessionsRefreshTickProvider.notifier).state++;
    ref.invalidate(sessionsListProvider);
    ref.invalidate(projectsForSessionsProvider);
    // Also refresh session statuses
    ref.read(globalSessionStatusProvider.notifier).fetchAllStatuses();
    await ref.read(sessionsListProvider.future);
  }

  void _showSessionsTitleFiltersSheet(BuildContext context) =>
      showSessionsTitleFiltersSheet(context);

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
      return ClaudeCodeSessionsView(onRefresh: _refresh);
    }
    if (agentType == AgentType.codex) {
      return CodexThreadsView(onRefresh: _refresh);
    }
    if (agentType == AgentType.pi) {
      return PiSessionsView(onRefresh: _refresh);
    }
    final connection = ref.watch(connectionProvider);
    final theme = Theme.of(context);
    final filterProjectPath = ref.watch(sessionsFilterProjectPathProvider);
    final projectsAsync = ref.watch(ocFilterProjectsProvider);
    final sessionsAsync = ref.watch(sessionsListProvider);
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: AdaptiveContainer(
          width: ContentWidth.standard,
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
                      final groupedSessions = ref.watch(
                        groupedSessionsProvider,
                      );
                      final backgroundTaskCount = groupedSessions.fold<int>(
                        0,
                        (sum, g) => sum + g.children.length,
                      );
                      final showBgTasks = ref.watch(
                        showBackgroundTasksProvider,
                      );
                      final titleFilterCount = ref
                          .watch(sessionsTitleExcludeFiltersProvider(agentType))
                          .length;
                      return _ModernHeader(
                        connection: connection,
                        filterProjectPath: filterProjectPath,
                        projects: projectsAsync,
                        projectsProvider: ocFilterProjectsProvider,
                        onFilterChanged: (path) {
                          ref
                                  .read(
                                    sessionsFilterProjectPathProvider.notifier,
                                  )
                                  .state =
                              path;
                          ref
                              .read(sessionsRefreshTickProvider.notifier)
                              .state++;
                        },
                        onRefresh: _refresh,
                        onNewSession: connection.isOfflineMode
                            ? null
                            : () => _showNewSessionSheet(context),
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
                        // Task 8: Session search
                        searchController: _searchController,
                        onSearchChanged: _onSearchChanged,
                      );
                    },
                  ),
                ),
                ...sessionsAsync.when(
                  loading: () => [
                    // Smart skeleton: only show after 100ms delay to prevent flash
                    const SliverToBoxAdapter(child: DelayedSkeletonList()),
                  ],
                  error: (error, _) => [
                    SliverFillRemaining(
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              AppIcons.error,
                              color: theme.colorScheme.error,
                              size: 48,
                            ),
                            const SizedBox(height: Spacing.lg),
                            Text(
                              'Failed to load sessions',
                              style: TextStyle(
                                color: theme.colorScheme.onSurface,
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: Spacing.sm),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 24,
                              ),
                              child: Text(
                                humanizeError(error),
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
                    final searchQuery = ref.watch(sessionsSearchQueryProvider);
                    if (sessions.isEmpty) {
                      if (searchQuery.isNotEmpty) {
                        return [
                          SliverFillRemaining(
                            child: Center(
                              child: Text(
                                'No sessions matching "$searchQuery"',
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.onSurface
                                      .withValues(alpha: 0.6),
                                  fontSize: 14,
                                ),
                              ),
                            ),
                          ),
                        ];
                      }
                      return [
                        const SliverFillRemaining(child: SessionsEmptyState()),
                      ];
                    }
                    // Sessions are already filtered server-side (search) and
                    // by project/title in the provider. No client-side search
                    // filtering needed here.
                    final groupedSessions = ref.watch(groupedSessionsProvider);
                    final showBgTasks = ref.watch(showBackgroundTasksProvider);
                    final expandedSessions = ref.watch(
                      expandedSessionsProvider,
                    );
                    final expandedProjects = ref.watch(
                      sessionsProjectExpandedProvider,
                    );
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
                    // Build items — grouped sessions minus highlighted ones
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
                      expandedProjects: expandedProjects,
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
                          delegate: SliverChildBuilderDelegate((
                            context,
                            index,
                          ) {
                            final item = items[index];
                            final ocTheme = OpenCodeTheme.of(context);
                            if (item is _SessionListHeader) {
                              return Padding(
                                padding: const EdgeInsets.fromLTRB(
                                  4,
                                  14,
                                  4,
                                  10,
                                ),
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
                                padding: Insets.bottomMd,
                                child: SessionCard(
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
                                      ? grouped.activeChildCount(
                                          sessionStatuses,
                                        )
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
                                child: ChildSessionCard(
                                  session: session,
                                  status: status,
                                  isOfflineMode: connection.isOfflineMode,
                                  onTap: () => _openSession(session),
                                ),
                              );
                            }
                            if (item is _LoadMoreItem) {
                              return LoadMoreButton(
                                remainingCount: item.remainingCount,
                                onTap: () {
                                  ref
                                      .read(
                                        sessionsProjectExpandedProvider
                                            .notifier,
                                      )
                                      .expand(item.directory);
                                },
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
      ),
      floatingActionButton: null,
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
    ref.read(selectionProvider.notifier).selectProject(project);
    ref.read(selectionProvider.notifier).selectSession(session);
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
    if (success) {
      showSuccess(context, 'Session deleted');
      _refresh();
    } else {
      showError(context, 'Failed to delete session');
    }
  }

  // Show options menu (highlight + rename + stop)
  Future<void> _showSessionOptions(SessionSummary session) =>
      showSessionOptionsSheet(
        context,
        session: session,
        onStop: _stopSession,
        onRename: _showRenameDialog,
        onFork: _forkSession,
        onArchive: _archiveSession,
        onShare: _shareSession,
        onUnshare: _unshareSession,
      );

  /// Stop/abort a session
  void _stopSession(SessionSummary session) {
    final bridge = ref.read(bridgeServiceProvider);
    // Send abort to bridge (directory is the project path)
    bridge.abortSession(session.id, projectPath: session.directory);
    // Show confirmation
    showSuccess(context, 'Stop signal sent to session');
    // Refresh session statuses after a short delay
    Future.delayed(const Duration(milliseconds: 500), () {
      ref.read(globalSessionStatusProvider.notifier).fetchAllStatuses();
    });
  }

  /// Archive or unarchive a session
  Future<void> _archiveSession(
    SessionSummary session, {
    required bool archive,
  }) async {
    final bridge = ref.read(bridgeServiceProvider);
    try {
      await bridge.updateSession(
        session.id,
        archived: archive,
        projectPath: session.directory,
      );
      if (!mounted) return;
      // Refresh sessions list
      ref.invalidate(sessionsListProvider);
      showSuccess(context, archive ? 'Session archived' : 'Session unarchived');
    } catch (e) {
      if (!mounted) return;
      showError(
        context,
        'Failed to ${archive ? 'archive' : 'unarchive'} session',
      );
    }
  }

  /// Share a session and copy the URL to clipboard
  Future<void> _shareSession(SessionSummary session) async {
    final bridge = ref.read(bridgeServiceProvider);
    try {
      final updated = await bridge.shareSession(
        session.id,
        projectPath: session.directory,
      );
      if (!mounted) return;
      // Refresh sessions list
      ref.invalidate(sessionsListProvider);
      final url = updated.share?.url ?? '';
      if (url.isNotEmpty) {
        await Clipboard.setData(ClipboardData(text: url));
        if (!mounted) return;
        showSuccess(context, 'Share link copied to clipboard');
      }
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to share session');
    }
  }

  /// Unshare a session (remove public URL)
  Future<void> _unshareSession(SessionSummary session) async {
    final bridge = ref.read(bridgeServiceProvider);
    final ocTheme = OpenCodeTheme.of(context);
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Unshare Session?'),
        content: const Text(
          'This will remove the public share link. Anyone with the link will no longer be able to view it.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text('Unshare', style: TextStyle(color: ocTheme.error)),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      await bridge.unshareSession(session.id, projectPath: session.directory);
      if (!mounted) return;
      // Refresh sessions list
      ref.invalidate(sessionsListProvider);
      showSuccess(context, 'Session unshared');
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to unshare session');
    }
  }

  /// Show bottom sheet to create a new session with project/worktree selection
  void _showNewSessionSheet(BuildContext context) {
    final projectsAsync = ref.read(projectsForSessionsProvider);
    DetailSheet.show(
      context: context,
      title: 'New Session',
      initialSize: 0.6,
      maxSize: 0.9,
      child: NewSessionContent(
        projects: projectsAsync.valueOrNull ?? [],
        onCreateSession: (project, worktree) async {
          Navigator.pop(context);
          await _createNewSession(project, worktree);
        },
      ),
    );
  }

  /// Create a new session for the given project and optional worktree
  Future<void> _createNewSession(
    ProjectSummary project,
    Worktree? worktree,
  ) async {
    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    final baseRules = ref.read(permissionRulesProvider).effectiveRuleset;
    final disabledTools = ref.read(toolSettingsProvider).disabledTools;
    final permissionRules = applyDisabledToolsToRuleset(
      baseRules,
      disabledTools,
    );
    final projectPath = worktree?.directory ?? project.path;
    try {
      final session = await bridge.createSession(
        projectPath: projectPath,
        permission: permissionRules,
      );
      chat.setSession(session, projectPath: projectPath);
      if (!mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ChatScreen(
            project: ProjectSummary(
              id: project.id,
              name: worktree?.displayName ?? project.name,
              path: projectPath,
            ),
            session: session,
          ),
        ),
      );
      if (!mounted) return;
      _refresh();
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to create session: ${humanizeError(e)}');
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
      showSuccess(context, 'Session renamed to "$newTitle"');
      _refresh();
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to rename session');
    }
  }

  Future<void> _forkSession(SessionSummary session) async {
    final bridge = ref.read(bridgeServiceProvider);
    try {
      final forked = await bridge.forkSession(
        session.id,
        projectPath: session.directory,
      );
      if (!mounted) return;
      showSuccess(context, 'Forked: ${forked.title}');
      _refresh();
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Fork failed: ${humanizeError(e)}');
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

/// "Load more" button for a project group
final class _LoadMoreItem extends _SessionRowItem {
  _LoadMoreItem({required this.directory, required this.remainingCount});
  final String directory;
  final int remainingCount;
}

/// Build list items with grouped sessions (parent + children).
/// When [grouped] is true, sessions are grouped by project directory with
/// a per-project limit of [kSessionsPerProjectDefault]. Projects in
/// [expandedProjects] show all their sessions; others get a "Load more" button.
List<_SessionRowItem> _buildGroupedListItems({
  required List<SessionWithChildren> groupedSessions,
  required Map<String, ProjectSummary> projectsByPath,
  required bool grouped,
  required bool showBackgroundTasks,
  required Set<String> expandedSessions,
  Set<String> expandedProjects = const {},
}) {
  String displayNameForDirectory(String directory) {
    final project = projectsByPath[directory];
    if (project != null && project.name.isNotEmpty) return project.name;
    final parts = directory.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Global' : parts.last;
  }

  void addSessionWithChildren(
    List<_SessionRowItem> items,
    SessionWithChildren g,
  ) {
    items.add(_SessionListItem(g.session));
    if (showBackgroundTasks &&
        g.hasChildren &&
        expandedSessions.contains(g.session.id)) {
      for (final child in g.children) {
        items.add(_ChildSessionItem(child));
      }
    }
  }

  if (!grouped) {
    // No project grouping — still apply the global limit
    final items = <_SessionRowItem>[];
    for (final g in groupedSessions) {
      addSessionWithChildren(items, g);
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
    final isProjectExpanded = expandedProjects.contains(directory);
    final limit = isProjectExpanded ? group.length : kSessionsPerProjectDefault;
    final visible = group.take(limit);
    for (final g in visible) {
      addSessionWithChildren(items, g);
    }
    // "Load more" button if there are hidden sessions
    final remaining = group.length - limit;
    if (remaining > 0) {
      items.add(_LoadMoreItem(directory: directory, remainingCount: remaining));
    }
  }
  return items;
}

/// Content widget for creating a new session with project/worktree selection
// Modern header
class _ModernHeader extends StatelessWidget {
  const _ModernHeader({
    required this.connection,
    required this.filterProjectPath,
    required this.projects,
    required this.projectsProvider,
    required this.onFilterChanged,
    required this.onRefresh,
    this.onNewSession,
    required this.titleFilterCount,
    required this.onTitleFiltersTap,
    required this.showBackgroundTasks,
    required this.onToggleBackgroundTasks,
    required this.backgroundTaskCount,
    this.searchController,
    this.onSearchChanged,
  });
  final BridgeConnectionState connection;
  final String? filterProjectPath;
  final AsyncValue<List<ProjectSummary>> projects;
  final ProviderListenable<AsyncValue<List<ProjectSummary>>> projectsProvider;
  final ValueChanged<String?> onFilterChanged;
  final VoidCallback onRefresh;
  final VoidCallback? onNewSession;
  final int titleFilterCount;
  final VoidCallback onTitleFiltersTap;
  final bool showBackgroundTasks;
  final VoidCallback onToggleBackgroundTasks;
  final int backgroundTaskCount;
  // Task 8: Session search
  final TextEditingController? searchController;
  final ValueChanged<String>? onSearchChanged;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final label = filterLabel(
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
              if (onNewSession != null)
                IconButton(
                  onPressed: onNewSession,
                  icon: Icon(AppIcons.add, color: ocTheme.textMuted),
                  tooltip: 'New session',
                ),
              IconButton(
                onPressed: onRefresh,
                icon: Icon(AppIcons.refresh, color: ocTheme.textMuted),
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
                  borderRadius: Radii.brMd,
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
          const SizedBox(height: Spacing.sm),
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
              FilterChipButton(
                label: label,
                onTap: () => showProjectFilter(
                  context: context,
                  theme: theme,
                  selectedPath: filterProjectPath,
                  projectsProvider: projectsProvider,
                  onSelected: onFilterChanged,
                ),
              ),
              const SizedBox(width: Spacing.sm),
              TitleFiltersChip(
                count: titleFilterCount,
                onTap: onTitleFiltersTap,
              ),
              const SizedBox(width: Spacing.sm),
              // Background tasks toggle
              if (backgroundTaskCount > 0)
                BackgroundTasksChip(
                  count: backgroundTaskCount,
                  isExpanded: showBackgroundTasks,
                  onTap: onToggleBackgroundTasks,
                ),
              const SizedBox(width: Spacing.sm),
              const ArchiveFilterChip(),
            ],
          ),
          // Task 8: Session search bar
          if (searchController != null && onSearchChanged != null) ...[
            const SizedBox(height: Spacing.md),
            SessionsSearchBar(
              controller: searchController!,
              onChanged: onSearchChanged!,
            ),
          ],
        ],
      ),
    );
  }
}

/// Chip button to toggle background tasks visibility
/// Sort chip for switching between createdAt and updatedAt sorting
// Modern filter tile widget

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
                Icon(AppIcons.star, size: 14, color: color),
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
              padding: Insets.bottomMd,
              child: HighlightedSessionCard(
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

/// Highlighted session card with clean minimal design and highlight accent

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

/// "Load more" button shown when a project group is truncated.
// ============================================================================
// Claude Code Sessions View
// ============================================================================

// ============================================================================
// PI SESSIONS VIEW
// ============================================================================
