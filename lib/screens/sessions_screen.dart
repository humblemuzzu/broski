import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../models/agent_type.dart';

import '../models/claude_code.dart';
import '../models/codex.dart';
import '../models/highlight_color.dart';
import '../models/permission_rule.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../models/worktree.dart';
import '../providers/agent_type_provider.dart';
import '../providers/chat_provider.dart';
import '../providers/claude_code_provider.dart';
import '../providers/codex_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/highlights_provider.dart';
import '../providers/permission_rules_provider.dart';
import '../providers/sessions_provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../providers/tool_settings_provider.dart';
import '../theme/opencode_theme.dart';
import '../utils/project_path_match.dart';
import '../widgets/background_session_widgets.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/sessions/codex_active_threads_section.dart';
import '../widgets/sessions/sessions_search_bar.dart';
import '../models/pi.dart';
import '../providers/pi_provider.dart';
import 'chat_screen.dart';
import 'package:broski/theme/app_icons.dart';

class SessionsScreen extends ConsumerStatefulWidget {
  const SessionsScreen({super.key});
  @override
  ConsumerState<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends ConsumerState<SessionsScreen> {
  // Task 8: Session search
  final _searchController = TextEditingController();
  String _searchQuery = '';
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
      setState(() => _searchQuery = value.trim().toLowerCase());
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

  void _showSessionsTitleFiltersSheet(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController();
    DetailSheet.show(
      context: context,
      title: 'Title Filters',
      initialSize: 0.6,
      child: Consumer(
        builder: (context, ref, _) {
          final filters = ref.watch(
            sessionsTitleExcludeFiltersProvider(AgentType.opencode),
          );
          final notifier = ref.read(
            sessionsTitleExcludeFiltersProvider(AgentType.opencode).notifier,
          );
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Hide sessions whose titles match any filter. Use `/regex/` for regex, otherwise it's a case-insensitive substring match.",
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
                ),
                SizedBox(height: Spacing.md),
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
                            borderRadius: Radii.brMd,
                            borderSide: BorderSide(color: ocTheme.borderSubtle),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: Radii.brMd,
                            borderSide: BorderSide(color: ocTheme.borderSubtle),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: Radii.brMd,
                            borderSide: BorderSide(color: ocTheme.primary),
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
                        foregroundColor: ocTheme.selectedListItemText,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                        shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
                      ),
                      child: const Text('Add'),
                    ),
                  ],
                ),
                SizedBox(height: Spacing.md),
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
                if (filters.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 24),
                    child: Center(
                      child: Text(
                        'No filters yet',
                        style: TextStyle(color: ocTheme.textMuted),
                      ),
                    ),
                  )
                else
                  ...filters.asMap().entries.map((entry) {
                    final index = entry.key;
                    final f = entry.value;
                    return Column(
                      children: [
                        if (index > 0) Divider(color: ocTheme.borderSubtle),
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: Icon(
                            f.startsWith('/') && f.endsWith('/')
                                ? AppIcons.code
                                : AppIcons.textFields,
                            color: ocTheme.textMuted,
                          ),
                          title: Text(f, style: TextStyle(color: ocTheme.text)),
                          trailing: IconButton(
                            onPressed: () => notifier.removeAt(index),
                            icon: Icon(AppIcons.delete, color: ocTheme.error),
                            tooltip: 'Remove',
                          ),
                        ),
                      ],
                    );
                  }),
              ],
            ),
          );
        },
      ),
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
    if (agentType == AgentType.codex) {
      return _CodexThreadsView(onRefresh: _refresh);
    }
    if (agentType == AgentType.pi) {
      return _PiSessionsView(onRefresh: _refresh);
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
                        ref.read(sessionsRefreshTickProvider.notifier).state++;
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
                  SliverToBoxAdapter(child: _DelayedSkeletonList()),
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
                          SizedBox(height: Spacing.lg),
                          Text(
                            'Failed to load sessions',
                            style: TextStyle(
                              color: theme.colorScheme.onSurface,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          SizedBox(height: Spacing.sm),
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
                  // Task 8: Apply search filter
                  final filteredSessions = _searchQuery.isEmpty
                      ? sessions
                      : sessions
                            .where(
                              (s) =>
                                  s.title.toLowerCase().contains(_searchQuery),
                            )
                            .toList();
                  if (filteredSessions.isEmpty && _searchQuery.isNotEmpty) {
                    return [
                      SliverFillRemaining(
                        child: Center(
                          child: Text(
                            'No sessions matching "$_searchQuery"',
                            style: TextStyle(
                              color: Theme.of(
                                context,
                              ).colorScheme.onSurface.withValues(alpha: 0.6),
                              fontSize: 14,
                            ),
                          ),
                        ),
                      ),
                    ];
                  }
                  // Use grouped sessions for hierarchical display
                  final groupedSessions = ref.watch(groupedSessionsProvider);
                  final showBgTasks = ref.watch(showBackgroundTasksProvider);
                  final expandedSessions = ref.watch(expandedSessionsProvider);
                  // Get highlighted sessions
                  final highlights = ref.watch(highlightsProvider);
                  final highlightColor = highlights.color;
                  // Filter to only root sessions (background tasks are nested)
                  final rootSessions = filteredSessions
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
                  // Task 8: Also filter grouped sessions by search query
                  final searchFilteredGrouped = _searchQuery.isEmpty
                      ? groupedSessions
                      : groupedSessions
                            .where(
                              (g) => g.session.title.toLowerCase().contains(
                                _searchQuery,
                              ),
                            )
                            .toList();
                  final regularGrouped = searchFilteredGrouped
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
                              padding: Insets.bottomMd,
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

  // Show options menu (highlight + rename + stop)
  Future<void> _showSessionOptions(SessionSummary session) async {
    final highlights = ref.read(highlightsProvider);
    final isHighlighted = highlights.isSessionHighlighted(session.id);
    final ocTheme = OpenCodeTheme.of(context);
    final highlightColor = highlights.color;
    final sessionStatuses = ref.read(globalSessionStatusProvider);
    final status = sessionStatuses[session.id];
    final isRunning = status?.isBusy == true || status?.isRetry == true;
    await DetailSheet.show(
      context: context,
      title: session.title,
      initialSize: 0.35,
      minSize: 0.2,
      maxSize: 0.5,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Stop Session option (shown when running or always for stuck sessions)
          ListTile(
            leading: Icon(
              AppIcons.stop,
              color: isRunning ? ocTheme.error : ocTheme.textMuted,
            ),
            title: Text(
              'Stop Session',
              style: TextStyle(color: isRunning ? ocTheme.error : ocTheme.text),
            ),
            subtitle: Text(
              isRunning
                  ? 'Session is currently running'
                  : 'Force stop if stuck',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _stopSession(session);
            },
          ),
          // Options
          ListTile(
            leading: Icon(
              isHighlighted ? AppIcons.star : AppIcons.starOutline,
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
            leading: Icon(AppIcons.edit, color: ocTheme.textMuted),
            title: Text('Rename', style: TextStyle(color: ocTheme.text)),
            onTap: () {
              Navigator.pop(context);
              _showRenameDialog(session);
            },
          ),
          // Archive / Unarchive
          ListTile(
            leading: Icon(
              session.isArchived ? AppIcons.unarchive : AppIcons.archive,
              color: session.isArchived ? ocTheme.textMuted : ocTheme.error,
            ),
            title: Text(
              session.isArchived ? 'Unarchive' : 'Archive',
              style: TextStyle(
                color: session.isArchived ? ocTheme.text : ocTheme.error,
              ),
            ),
            onTap: () {
              Navigator.pop(context);
              _archiveSession(session, archive: !session.isArchived);
            },
          ),
          // Share / Unshare
          ListTile(
            leading: Icon(
              session.isShared ? AppIcons.unlink : AppIcons.share,
              color: ocTheme.textMuted,
            ),
            title: Text(
              session.isShared ? 'Unshare' : 'Share',
              style: TextStyle(color: ocTheme.text),
            ),
            subtitle: session.isShared
                ? Text(
                    session.share!.url,
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  )
                : null,
            onTap: () {
              Navigator.pop(context);
              if (session.isShared) {
                _unshareSession(session);
              } else {
                _shareSession(session);
              }
            },
          ),
        ],
      ),
    );
  }

  /// Stop/abort a session
  void _stopSession(SessionSummary session) {
    final bridge = ref.read(bridgeServiceProvider);
    final ocTheme = OpenCodeTheme.of(context);
    // Send abort to bridge (directory is the project path)
    bridge.abortSession(session.id, projectPath: session.directory);
    // Show confirmation
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Stop signal sent to session'),
        backgroundColor: ocTheme.backgroundPanel,
        behavior: SnackBarBehavior.floating,
      ),
    );
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
    final ocTheme = OpenCodeTheme.of(context);
    try {
      await bridge.updateSession(
        session.id,
        archived: archive,
        projectPath: session.directory,
      );
      if (!mounted) return;
      // Refresh sessions list
      ref.invalidate(sessionsListProvider);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(archive ? 'Session archived' : 'Session unarchived'),
          backgroundColor: ocTheme.backgroundPanel,
          behavior: SnackBarBehavior.floating,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Failed to ${archive ? 'archive' : 'unarchive'} session',
          ),
          backgroundColor: ocTheme.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  /// Share a session and copy the URL to clipboard
  Future<void> _shareSession(SessionSummary session) async {
    final bridge = ref.read(bridgeServiceProvider);
    final ocTheme = OpenCodeTheme.of(context);
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Share link copied to clipboard'),
            backgroundColor: ocTheme.backgroundPanel,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Failed to share session'),
          backgroundColor: ocTheme.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Session unshared'),
          backgroundColor: ocTheme.backgroundPanel,
          behavior: SnackBarBehavior.floating,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Failed to unshare session'),
          backgroundColor: ocTheme.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
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
      child: _NewSessionContent(
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
      final ocTheme = OpenCodeTheme.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to create session: $e'),
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

/// Content widget for creating a new session with project/worktree selection
class _NewSessionContent extends ConsumerStatefulWidget {
  const _NewSessionContent({
    required this.projects,
    required this.onCreateSession,
  });
  final List<ProjectSummary> projects;
  final Future<void> Function(ProjectSummary project, Worktree? worktree)
  onCreateSession;
  @override
  ConsumerState<_NewSessionContent> createState() => _NewSessionContentState();
}

class _NewSessionContentState extends ConsumerState<_NewSessionContent> {
  ProjectSummary? _selectedProject;
  Worktree? _selectedWorktree;
  List<Worktree>? _worktrees;
  bool _loadingWorktrees = false;
  bool _creating = false;
  @override
  void initState() {
    super.initState();
    // Auto-select first project if only one
    if (widget.projects.length == 1) {
      _selectedProject = widget.projects.first;
      _loadWorktrees(_selectedProject!);
    }
  }

  Future<void> _loadWorktrees(ProjectSummary project) async {
    setState(() {
      _loadingWorktrees = true;
      _worktrees = null;
      _selectedWorktree = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final worktrees = await bridge.listWorktrees(projectPath: project.path);
      if (mounted) {
        setState(() {
          _worktrees = worktrees;
          _loadingWorktrees = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _worktrees = [];
          _loadingWorktrees = false;
        });
      }
    }
  }

  void _selectProject(ProjectSummary project) {
    setState(() {
      _selectedProject = project;
      _selectedWorktree = null;
    });
    _loadWorktrees(project);
  }

  Future<void> _createSession() async {
    if (_selectedProject == null || _creating) return;
    setState(() => _creating = true);
    try {
      await widget.onCreateSession(_selectedProject!, _selectedWorktree);
    } finally {
      if (mounted) {
        setState(() => _creating = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    if (widget.projects.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.folderOff, color: ocTheme.textMuted, size: 48),
            SizedBox(height: Spacing.lg),
            Text(
              'No projects found',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 16),
            ),
          ],
        ),
      );
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Project selection
              Text(
                'Select Project',
                style: TextStyle(
                  color: ocTheme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              SizedBox(height: Spacing.sm),
              ...widget.projects.map((project) {
                final isSelected = _selectedProject?.id == project.id;
                return _ProjectSelectionTile(
                  project: project,
                  isSelected: isSelected,
                  onTap: () => _selectProject(project),
                );
              }),
              // Worktrees section (if project selected)
              if (_selectedProject != null) ...[
                SizedBox(height: Spacing.xl),
                Text(
                  'Select Worktree (Optional)',
                  style: TextStyle(
                    color: ocTheme.textMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                SizedBox(height: Spacing.sm),
                if (_loadingWorktrees)
                  const Center(
                    child: Padding(
                      padding: Insets.screenAll,
                      child: CircularProgressIndicator.adaptive(),
                    ),
                  )
                else if (_worktrees == null || _worktrees!.isEmpty)
                  Container(
                    padding: Insets.card,
                    decoration: BoxDecoration(
                      color: ocTheme.background,
                      borderRadius: Radii.brMd,
                      border: Border.all(color: ocTheme.border),
                    ),
                    child: Row(
                      children: [
                        Icon(AppIcons.info, color: ocTheme.textMuted, size: 20),
                        SizedBox(width: Spacing.md),
                        Expanded(
                          child: Text(
                            'No worktrees found. Session will use main project.',
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 14,
                            ),
                          ),
                        ),
                      ],
                    ),
                  )
                else ...[
                  // Main project option
                  _WorktreeSelectionTile(
                    name: 'Main Project',
                    path: _selectedProject!.path,
                    isMain: true,
                    isSelected: _selectedWorktree == null,
                    onTap: () => setState(() => _selectedWorktree = null),
                  ),
                  // Worktrees
                  ..._worktrees!.map((worktree) {
                    final isSelected =
                        _selectedWorktree?.directory == worktree.directory;
                    return _WorktreeSelectionTile(
                      name: worktree.displayName,
                      path: worktree.directory,
                      isMain: false,
                      isSelected: isSelected,
                      onTap: () => setState(() => _selectedWorktree = worktree),
                    );
                  }),
                ],
              ],
            ],
          ),
        ),
        // Create button
        Padding(
          padding: Insets.card,
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _selectedProject == null || _creating
                  ? null
                  : _createSession,
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.colorScheme.primary,
                foregroundColor: theme.colorScheme.onPrimary,
                disabledBackgroundColor: ocTheme.border,
                padding: Insets.screenV,
                shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
              ),
              child: _creating
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator.adaptive(strokeWidth: 2),
                    )
                  : const Text(
                      'Create Session',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
            ),
          ),
        ),
      ],
    );
  }
}

class _ProjectSelectionTile extends StatelessWidget {
  const _ProjectSelectionTile({
    required this.project,
    required this.isSelected,
    required this.onTap,
  });
  final ProjectSummary project;
  final bool isSelected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: Insets.bottomSm,
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: isSelected
              ? ocTheme.primary.withValues(alpha: 0.1)
              : ocTheme.background,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isSelected ? ocTheme.primary : ocTheme.border,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              padding: Insets.cardXs,
              decoration: BoxDecoration(
                color: isSelected
                    ? ocTheme.primary.withValues(alpha: 0.2)
                    : ocTheme.border.withValues(alpha: 0.3),
                borderRadius: Radii.brSm,
              ),
              child: Icon(
                AppIcons.folder,
                color: isSelected ? ocTheme.primary : ocTheme.textMuted,
                size: 20,
              ),
            ),
            SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    project.name,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  SizedBox(height: Spacing.xxs),
                  Text(
                    project.path,
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(AppIcons.checkCircle, color: ocTheme.primary, size: 22),
          ],
        ),
      ),
    );
  }
}

class _WorktreeSelectionTile extends StatelessWidget {
  const _WorktreeSelectionTile({
    required this.name,
    required this.path,
    required this.isMain,
    required this.isSelected,
    required this.onTap,
  });
  final String name;
  final String path;
  final bool isMain;
  final bool isSelected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: Insets.bottomSm,
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: isSelected
              ? ocTheme.primary.withValues(alpha: 0.1)
              : ocTheme.background,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isSelected ? ocTheme.primary : ocTheme.border,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              isMain ? AppIcons.home : AppIcons.gitBranch,
              color: isSelected ? ocTheme.primary : ocTheme.textMuted,
              size: 20,
            ),
            SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  Text(
                    path,
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(AppIcons.checkCircle, color: ocTheme.primary, size: 20),
          ],
        ),
      ),
    );
  }
}

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
          SizedBox(height: Spacing.sm),
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
                  projectsProvider: projectsProvider,
                  onSelected: onFilterChanged,
                ),
              ),
              SizedBox(width: Spacing.sm),
              _TitleFiltersChip(
                count: titleFilterCount,
                onTap: onTitleFiltersTap,
              ),
              SizedBox(width: Spacing.sm),
              // Background tasks toggle
              if (backgroundTaskCount > 0)
                _BackgroundTasksChip(
                  count: backgroundTaskCount,
                  isExpanded: showBackgroundTasks,
                  onTap: onToggleBackgroundTasks,
                ),
            ],
          ),
          // Task 8: Session search bar
          if (searchController != null && onSearchChanged != null) ...[
            SizedBox(height: Spacing.md),
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
            SizedBox(width: Spacing.xs),
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
            SizedBox(width: Spacing.sm),
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

/// Sort chip for switching between createdAt and updatedAt sorting
class _SortChip extends StatelessWidget {
  const _SortChip({required this.sortBy, required this.onChanged});
  final String sortBy;
  final ValueChanged<String> onChanged;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final isUpdatedAt = sortBy == 'updatedAt';
    return InkWell(
      onTap: () => onChanged(isUpdatedAt ? 'createdAt' : 'updatedAt'),
      borderRadius: Radii.brFull,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brFull,
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.sort, size: 14, color: ocTheme.textMuted),
            const SizedBox(width: 6),
            Text(
              isUpdatedAt ? 'Updated' : 'Created',
              style: TextStyle(
                color: ocTheme.text,
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
              _FilterProjectTile(
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
        );
      },
    ),
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
                    SizedBox(height: Spacing.xxs),
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

/// Highlighted session card with clean minimal design and highlight accent
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

  /// Get last activity from session diffs
  String? _getLastActivity() {
    final diffs = session.summary?.diffs;
    if (diffs == null || diffs.isEmpty) return null;
    final lastDiff = diffs.last;
    final fileName = lastDiff.file.split('/').last;
    return fileName;
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
    final stats = session.summary;
    final hasStats =
        stats != null &&
        (stats.additions > 0 || stats.deletions > 0 || stats.files > 0);
    final lastActivity = _getLastActivity();
    Widget card = GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        decoration: BoxDecoration(color: bgColor, borderRadius: Radii.brMd),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar (highlight color)
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: color,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                ),
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title row with star + time/status
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Star icon inline
                        Icon(AppIcons.star, size: 16, color: color),
                        SizedBox(width: Spacing.sm),
                        Expanded(
                          child: Text(
                            session.title,
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              height: 1.3,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        SizedBox(width: Spacing.md),
                        // Status or time
                        if (isActive)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: 10,
                                height: 10,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    status!.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                status!.isRetry ? 'Retry' : 'Working',
                                style: TextStyle(
                                  color: status!.isRetry
                                      ? ocTheme.warning
                                      : ocTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          )
                        else
                          Text(
                            _formatDate(session.time.updated),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Meta row: project + stats
                    Row(
                      children: [
                        // Project name
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        // Last edited file
                        if (lastActivity != null) ...[
                          Text(
                            ' · ',
                            style: TextStyle(
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
                              fontSize: 12,
                            ),
                          ),
                          Flexible(
                            child: Text(
                              lastActivity,
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 12,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        const Spacer(),
                        // Stats badges
                        if (hasStats) ...[
                          if (stats.additions > 0)
                            _StatBadge(
                              text: '+${stats.additions}',
                              color: ocTheme.diffAdded,
                            ),
                          if (stats.deletions > 0) ...[
                            const SizedBox(width: 6),
                            _StatBadge(
                              text: '-${stats.deletions}',
                              color: ocTheme.diffRemoved,
                            ),
                          ],
                          if (stats.files > 0) ...[
                            const SizedBox(width: 6),
                            Text(
                              '${stats.files} ${stats.files == 1 ? 'file' : 'files'}',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ],
                      ],
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
            borderRadius: Radii.brMd,
          ),
          child: Icon(
            AppIcons.delete,
            color: ocTheme.selectedListItemText,
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

// Session card with clean, minimal modern design
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

  /// Get last activity from session diffs
  String? _getLastActivity() {
    final diffs = session.summary?.diffs;
    if (diffs == null || diffs.isEmpty) return null;
    final lastDiff = diffs.last;
    final fileName = lastDiff.file.split('/').last;
    return fileName;
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final stats = session.summary;
    final hasStats =
        stats != null &&
        (stats.additions > 0 || stats.deletions > 0 || stats.files > 0);
    final lastActivity = _getLastActivity();
    // Accent color for left bar
    final accentColor = isActive
        ? (status!.isRetry ? ocTheme.warning : ocTheme.info)
        : ocTheme.primary.withValues(alpha: 0.4);
    Widget card = GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brMd,
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: accentColor,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                ),
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title row with time/status
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            session.title,
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              height: 1.3,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        SizedBox(width: Spacing.md),
                        // Status or time
                        if (isActive)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: 10,
                                height: 10,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    status!.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                status!.isRetry ? 'Retry' : 'Working',
                                style: TextStyle(
                                  color: status!.isRetry
                                      ? ocTheme.warning
                                      : ocTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          )
                        else
                          Text(
                            _formatDate(session.time.updated),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Meta row: project + stats
                    Row(
                      children: [
                        // Project name
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        // Forked indicator
                        if (session.isForkedSession) ...[
                          SizedBox(width: Spacing.sm),
                          Icon(
                            AppIcons.forkRight,
                            size: 12,
                            color: ocTheme.accent,
                          ),
                        ],
                        // Last edited file
                        if (lastActivity != null) ...[
                          Text(
                            ' · ',
                            style: TextStyle(
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
                              fontSize: 12,
                            ),
                          ),
                          Flexible(
                            child: Text(
                              lastActivity,
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 12,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        const Spacer(),
                        // Stats badges
                        if (hasStats) ...[
                          if (stats.additions > 0)
                            _StatBadge(
                              text: '+${stats.additions}',
                              color: ocTheme.diffAdded,
                            ),
                          if (stats.deletions > 0) ...[
                            const SizedBox(width: 6),
                            _StatBadge(
                              text: '-${stats.deletions}',
                              color: ocTheme.diffRemoved,
                            ),
                          ],
                          if (stats.files > 0) ...[
                            const SizedBox(width: 6),
                            Text(
                              '${stats.files} ${stats.files == 1 ? 'file' : 'files'}',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 11,
                              ),
                            ),
                          ],
                        ],
                      ],
                    ),
                    // Background tasks row
                    if (hasChildren) ...[
                      const SizedBox(height: 10),
                      GestureDetector(
                        onTap: onToggleExpand,
                        behavior: HitTestBehavior.opaque,
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              AppIcons.gitBranch,
                              size: 12,
                              color: activeChildCount > 0
                                  ? ocTheme.info
                                  : ocTheme.textMuted,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              '$childCount ${childCount == 1 ? 'task' : 'tasks'}',
                              style: TextStyle(
                                color: activeChildCount > 0
                                    ? ocTheme.info
                                    : ocTheme.textMuted,
                                fontSize: 11,
                              ),
                            ),
                            if (activeChildCount > 0) ...[
                              Text(
                                ' · $activeChildCount active',
                                style: TextStyle(
                                  color: ocTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                            SizedBox(width: Spacing.xs),
                            AnimatedRotation(
                              turns: isExpanded ? 0.25 : 0,
                              duration: const Duration(milliseconds: 200),
                              child: Icon(
                                AppIcons.chevronRight,
                                color: activeChildCount > 0
                                    ? ocTheme.info
                                    : ocTheme.textMuted,
                                size: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
    // Wrap with Dismissible for swipe-to-delete (only when online)
    if (onDelete != null) {
      card = Dismissible(
        key: Key(session.id),
        direction: DismissDirection.endToStart,
        background: Container(
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          decoration: BoxDecoration(
            color: ocTheme.error,
            borderRadius: Radii.brMd,
          ),
          child: Icon(
            AppIcons.delete,
            color: ocTheme.selectedListItemText,
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

/// Small stat badge for session cards (additions, deletions, files)
class _StatBadge extends StatelessWidget {
  const _StatBadge({
    required this.text,
    required this.color,
    this.isFile = false,
  });
  final String text;
  final Color color;
  final bool isFile;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: isFile
            ? ocTheme.backgroundElement.withValues(alpha: 0.6)
            : color.withValues(alpha: 0.12),
        borderRadius: Radii.brXs,
      ),
      child: Text(
        text,
        style: TextStyle(
          color: isFile ? ocTheme.textMuted : color,
          fontSize: 10,
          fontWeight: FontWeight.w600,
          fontFamily: AppTypography.codeFontFamily,
        ),
      ),
    );
  }
}

/// Card for child (background task) sessions - clean compact design
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
    final stats = session.summary;
    final hasStats =
        stats != null &&
        (stats.additions > 0 || stats.deletions > 0 || stats.files > 0);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: ocTheme.backgroundElement.withValues(alpha: 0.4),
          borderRadius: Radii.brSm,
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar (info color for tasks)
            Container(
              width: 2,
              decoration: BoxDecoration(
                color: isActive
                    ? ocTheme.info
                    : ocTheme.info.withValues(alpha: 0.4),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(8),
                  bottomLeft: Radius.circular(8),
                ),
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
                child: Row(
                  children: [
                    // Content
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Title with optional agent badge
                          Row(
                            children: [
                              if (agentName != null) ...[
                                Text(
                                  '@$agentName',
                                  style: TextStyle(
                                    color: ocTheme.info,
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(width: 6),
                              ],
                              Expanded(
                                child: Text(
                                  cleanTitle,
                                  style: TextStyle(
                                    color: ocTheme.text.withValues(alpha: 0.85),
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          SizedBox(height: Spacing.xs),
                          // Stats + time row
                          Row(
                            children: [
                              Text(
                                _formatDate(session.time.updated),
                                style: TextStyle(
                                  color: ocTheme.textMuted,
                                  fontSize: 11,
                                ),
                              ),
                              if (hasStats) ...[
                                Text(
                                  ' · ',
                                  style: TextStyle(
                                    color: ocTheme.textMuted.withValues(
                                      alpha: 0.5,
                                    ),
                                    fontSize: 11,
                                  ),
                                ),
                                if (stats.additions > 0)
                                  Text(
                                    '+${stats.additions}',
                                    style: TextStyle(
                                      color: ocTheme.diffAdded,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                if (stats.additions > 0 && stats.deletions > 0)
                                  Text(
                                    ' ',
                                    style: TextStyle(
                                      color: ocTheme.textMuted,
                                      fontSize: 11,
                                    ),
                                  ),
                                if (stats.deletions > 0)
                                  Text(
                                    '-${stats.deletions}',
                                    style: TextStyle(
                                      color: ocTheme.diffRemoved,
                                      fontSize: 11,
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                              ],
                            ],
                          ),
                        ],
                      ),
                    ),
                    // Status indicator
                    if (isActive)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(
                            strokeWidth: 1.5,
                            valueColor: AlwaysStoppedAnimation<Color>(
                              status!.isRetry ? ocTheme.warning : ocTheme.info,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
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
            padding: Insets.cardLg,
            decoration: BoxDecoration(
              color: ocTheme.primary.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(AppIcons.history, size: 48, color: ocTheme.primary),
          ),
          SizedBox(height: Spacing.xxl),
          Text(
            'No sessions yet',
            style: TextStyle(
              color: ocTheme.text,
              fontSize: 20,
              fontWeight: FontWeight.w600,
            ),
          ),
          SizedBox(height: Spacing.sm),
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
            borderRadius: Radii.brLg,
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
              SizedBox(width: Spacing.md),
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
                    SizedBox(height: Spacing.sm),
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
              SizedBox(width: Spacing.sm),
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
          (index) =>
              Padding(padding: Insets.bottomMd, child: _SkeletonSessionCard()),
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
      padding: Insets.card,
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: ocTheme.info.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(AppIcons.play, color: ocTheme.info, size: 20),
              SizedBox(width: Spacing.md),
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
          SizedBox(height: Spacing.md),
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
              padding: Insets.bottomSm,
              child: GestureDetector(
                onTap: onSessionTap != null
                    ? () => onSessionTap!(session)
                    : null,
                child: Container(
                  padding: Insets.cardSm,
                  decoration: BoxDecoration(
                    color: ocTheme.backgroundElement,
                    borderRadius: Radii.brMd,
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
                      SizedBox(width: Spacing.md),
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
                            SizedBox(height: Spacing.xxs),
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
                                  SizedBox(width: Spacing.sm),
                                  Container(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 6,
                                      vertical: 2,
                                    ),
                                    decoration: BoxDecoration(
                                      color: ocTheme.warning.withValues(
                                        alpha: 0.15,
                                      ),
                                      borderRadius: Radii.brXs,
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
                        AppIcons.chevronRight,
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

class _CodexThreadsView extends ConsumerStatefulWidget {
  const _CodexThreadsView({required this.onRefresh});
  final Future<void> Function() onRefresh;
  @override
  ConsumerState<_CodexThreadsView> createState() => _CodexThreadsViewState();
}

class _CodexThreadsViewState extends ConsumerState<_CodexThreadsView> {
  // Sort order: 'createdAt' (default) or 'updatedAt'
  String _sortBy = 'createdAt';
  final _searchController = TextEditingController();
  String _searchQuery = '';
  Timer? _searchDebounce;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(codexThreadsProvider.notifier).load();
    });
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      setState(() => _searchQuery = value.trim().toLowerCase());
    });
  }

  Future<void> _refresh() async {
    await ref.read(codexThreadsProvider.notifier).refresh();
    ref.invalidate(codexProjectsForThreadsProvider);
    await widget.onRefresh();
  }

  void _openThread(CodexThread thread) {
    final cwd = thread.cwd;
    if (cwd.isNotEmpty) {
      final parts = cwd.split('/').where((p) => p.isNotEmpty).toList();
      final project = ProjectSummary(
        id: '',
        name: parts.isEmpty ? 'Project' : parts.last,
        path: cwd,
      );
      ref.read(selectionProvider.notifier).selectProject(project);
    }
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => ChatScreen.codex(cxThread: thread)),
    );
  }

  void _showTitleFiltersSheet(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController();
    DetailSheet.show(
      context: context,
      title: 'Title Filters',
      initialSize: 0.6,
      minSize: 0.3,
      maxSize: 0.85,
      child: Consumer(
        builder: (context, ref, _) {
          final filters = ref.watch(
            sessionsTitleExcludeFiltersProvider(AgentType.codex),
          );
          final notifier = ref.read(
            sessionsTitleExcludeFiltersProvider(AgentType.codex).notifier,
          );
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Hide threads whose titles match any filter. Use `/regex/` for regex, otherwise it's a case-insensitive substring match.",
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
                ),
                SizedBox(height: Spacing.md),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: controller,
                        decoration: InputDecoration(
                          hintText: 'e.g. tmp, /wip.*/',
                          hintStyle: TextStyle(color: ocTheme.textMuted),
                          filled: true,
                          fillColor: ocTheme.backgroundElement,
                          border: OutlineInputBorder(
                            borderRadius: Radii.brMd,
                            borderSide: BorderSide(color: ocTheme.borderSubtle),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: Radii.brMd,
                            borderSide: BorderSide(color: ocTheme.borderSubtle),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: Radii.brMd,
                            borderSide: BorderSide(color: ocTheme.primary),
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
                        foregroundColor: ocTheme.selectedListItemText,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                        shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
                      ),
                      child: const Text('Add'),
                    ),
                  ],
                ),
                SizedBox(height: Spacing.md),
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
                                    ? AppIcons.code
                                    : AppIcons.textFields,
                                color: ocTheme.textMuted,
                              ),
                              title: Text(
                                f,
                                style: TextStyle(color: ocTheme.text),
                              ),
                              trailing: IconButton(
                                onPressed: () => notifier.removeAt(index),
                                icon: Icon(
                                  AppIcons.delete,
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
    ).whenComplete(controller.dispose);
  }

  void _showThreadOptions(CodexThread thread) {
    final ocTheme = OpenCodeTheme.of(context);
    final highlights = ref.read(highlightsProvider);
    final isHighlighted = highlights.isSessionHighlighted(thread.id);
    DetailSheet.show(
      context: context,
      title: thread.displayTitle,
      initialSize: 0.35,
      minSize: 0.2,
      maxSize: 0.5,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Stop Thread option
          ListTile(
            leading: Icon(AppIcons.stop, color: ocTheme.textMuted),
            title: Text('Stop Thread', style: TextStyle(color: ocTheme.text)),
            subtitle: Text(
              'Force stop if stuck',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _stopThread(thread);
            },
          ),
          ListTile(
            leading: Icon(
              isHighlighted ? AppIcons.star : AppIcons.starOutline,
              color: ocTheme.text,
            ),
            title: Text(
              isHighlighted ? 'Unhighlight' : 'Highlight',
              style: TextStyle(color: ocTheme.text),
            ),
            onTap: () {
              ref.read(highlightsProvider.notifier).toggleSession(thread.id);
              Navigator.pop(context);
            },
          ),
          ListTile(
            leading: Icon(AppIcons.edit, color: ocTheme.text),
            title: Text('Rename', style: TextStyle(color: ocTheme.text)),
            onTap: () {
              Navigator.pop(context);
              _renameThread(thread);
            },
          ),
          ListTile(
            leading: Icon(AppIcons.forkRight, color: ocTheme.text),
            title: Text('Fork', style: TextStyle(color: ocTheme.text)),
            subtitle: Text(
              'Create a copy of this thread',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _forkThread(thread);
            },
          ),
          ListTile(
            leading: Icon(AppIcons.archive, color: ocTheme.error),
            title: Text('Archive', style: TextStyle(color: ocTheme.error)),
            onTap: () async {
              Navigator.pop(context);
              await _archiveThread(thread);
            },
          ),
        ],
      ),
    );
  }

  void _renameThread(CodexThread thread) {
    final controller = TextEditingController(text: thread.threadName ?? '');
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Rename Thread'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Thread name'),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () async {
              final name = controller.text.trim();
              if (name.isEmpty) return;
              Navigator.pop(ctx);
              try {
                await ref
                    .read(bridgeServiceProvider)
                    .cxRenameThread(threadId: thread.id, name: name);
                widget.onRefresh();
              } catch (e) {
                if (mounted) {
                  ScaffoldMessenger.of(
                    context,
                  ).showSnackBar(SnackBar(content: Text('Rename failed: $e')));
                }
              }
            },
            child: const Text('Rename'),
          ),
        ],
      ),
    );
  }

  void _forkThread(CodexThread thread) async {
    try {
      final forked = await ref
          .read(bridgeServiceProvider)
          .cxThreadFork(threadId: thread.id);
      widget.onRefresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Forked: ${forked.displayTitle}')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Fork failed: $e')));
      }
    }
  }

  /// Stop/abort a Codex thread
  void _stopThread(CodexThread thread) {
    final bridge = ref.read(bridgeServiceProvider);
    final ocTheme = OpenCodeTheme.of(context);
    // Send abort to bridge
    bridge.cxAbort(threadId: thread.id);
    // Show confirmation
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Stop signal sent to thread'),
        backgroundColor: ocTheme.backgroundPanel,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  Future<void> _archiveThread(CodexThread thread) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Archive Thread?'),
        content: Text(
          'Archive "${thread.displayTitle}"? This hides it from the list.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: Text(
              'Archive',
              style: TextStyle(color: OpenCodeTheme.of(context).error),
            ),
          ),
        ],
      ),
    );
    if (confirm != true) return;
    final ok = await ref
        .read(codexThreadsProvider.notifier)
        .archiveThread(thread.id);
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok ? 'Thread archived' : 'Failed to archive thread'),
        backgroundColor: ok
            ? OpenCodeTheme.of(context).backgroundPanel
            : OpenCodeTheme.of(context).error,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    final threadsAsync = ref.watch(codexThreadsProvider);
    final highlights = ref.watch(highlightsProvider);
    final filterCwd = ref.watch(codexThreadsFilterCwdProvider);
    final codexFilterProjects = ref.watch(codexFilterProjectsProvider);
    final titleFilterCount = ref
        .watch(sessionsTitleExcludeFiltersProvider(AgentType.codex))
        .length;
    final filterLabel = _filterLabel(
      selectedPath: filterCwd,
      projects: codexFilterProjects,
    );
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
              SliverToBoxAdapter(
                child: CodexActiveThreadsSection(onThreadTap: _openThread),
              ),
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.primary.withValues(alpha: 0.12),
                              borderRadius: Radii.brMd,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  AppIcons.autoAwesome,
                                  size: 14,
                                  color: ocTheme.primary,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  'Codex',
                                  style: TextStyle(
                                    color: ocTheme.primary,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: Spacing.sm),
                      Text(
                        'Codex threads from app-server',
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
                              projectsProvider: codexFilterProjectsProvider,
                              onSelected: (path) {
                                ref
                                        .read(
                                          codexThreadsFilterCwdProvider
                                              .notifier,
                                        )
                                        .state =
                                    path;
                                ref.read(codexThreadsProvider.notifier).load();
                              },
                            ),
                          ),
                          SizedBox(width: Spacing.sm),
                          _TitleFiltersChip(
                            count: titleFilterCount,
                            onTap: () => _showTitleFiltersSheet(context),
                          ),
                          SizedBox(width: Spacing.sm),
                          _SortChip(
                            sortBy: _sortBy,
                            onChanged: (value) {
                              setState(() => _sortBy = value);
                            },
                          ),
                        ],
                      ),
                      SizedBox(height: Spacing.md),
                      SessionsSearchBar(
                        controller: _searchController,
                        onChanged: _onSearchChanged,
                        hintText: 'Search Codex threads...',
                      ),
                    ],
                  ),
                ),
              ),
              ...threadsAsync.when(
                loading: () => [
                  SliverToBoxAdapter(child: _DelayedSkeletonList()),
                ],
                error: (error, _) => [
                  SliverFillRemaining(
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(AppIcons.error, color: ocTheme.error, size: 48),
                          SizedBox(height: Spacing.lg),
                          Text(
                            'Failed to load threads',
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          SizedBox(height: Spacing.sm),
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
                data: (threads) {
                  final titleFilters = ref.watch(
                    sessionsTitleExcludeFiltersProvider(AgentType.codex),
                  );
                  final filtered =
                      threads
                          .where((t) => projectPathMatches(t.cwd, filterCwd))
                          .where(
                            (t) => titleFilters.isEmpty
                                ? true
                                : !sessionTitleMatchesExcludeFilters(
                                    t.displayTitle,
                                    titleFilters,
                                  ),
                          )
                          .where(
                            (t) => _searchQuery.isEmpty
                                ? true
                                : t.displayTitle.toLowerCase().contains(
                                    _searchQuery,
                                  ),
                          )
                          .toList()
                        ..sort((a, b) {
                          if (_sortBy == 'updatedAt') {
                            return b.updatedAt.compareTo(a.updatedAt);
                          }
                          return b.createdAt.compareTo(a.createdAt);
                        });
                  if (filtered.isEmpty) {
                    if (_searchQuery.isNotEmpty) {
                      return [
                        SliverFillRemaining(
                          child: Center(
                            child: Text(
                              'No threads matching "$_searchQuery"',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 14,
                              ),
                            ),
                          ),
                        ),
                      ];
                    }
                    return [SliverFillRemaining(child: _CodexEmptyState())];
                  }
                  final highlightedThreads = filtered
                      .where((t) => highlights.isSessionHighlighted(t.id))
                      .toList();
                  final regularThreads = filtered
                      .where((t) => !highlights.isSessionHighlighted(t.id))
                      .toList();
                  return [
                    if (highlightedThreads.isNotEmpty)
                      SliverToBoxAdapter(
                        child: _CodexHighlightedThreadsSection(
                          threads: highlightedThreads,
                          highlightColor: highlights.color,
                          onTap: _openThread,
                          onLongPress: _showThreadOptions,
                        ),
                      ),
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate((context, index) {
                          final t = regularThreads[index];
                          final isHighlighted = highlights.isSessionHighlighted(
                            t.id,
                          );
                          return Padding(
                            padding: Insets.bottomMd,
                            child: _CodexThreadCard(
                              thread: t,
                              isHighlighted: isHighlighted,
                              highlightColor: highlights.color,
                              onTap: () => _openThread(t),
                              onLongPress: () => _showThreadOptions(t),
                            ),
                          );
                        }, childCount: regularThreads.length),
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

/// Section showing highlighted Codex threads at the top
class _CodexHighlightedThreadsSection extends StatelessWidget {
  const _CodexHighlightedThreadsSection({
    required this.threads,
    required this.highlightColor,
    required this.onTap,
    required this.onLongPress,
  });
  final List<CodexThread> threads;
  final HighlightColor highlightColor;
  final void Function(CodexThread) onTap;
  final void Function(CodexThread) onLongPress;
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
          // Highlighted thread cards
          ...threads.map(
            (t) => Padding(
              padding: Insets.bottomMd,
              child: _CodexHighlightedThreadCard(
                thread: t,
                highlightColor: highlightColor,
                onTap: () => onTap(t),
                onLongPress: () => onLongPress(t),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Highlighted Codex thread card with accent styling
/// Matches OpenCode's _HighlightedSessionCard design
class _CodexHighlightedThreadCard extends ConsumerWidget {
  const _CodexHighlightedThreadCard({
    required this.thread,
    required this.highlightColor,
    required this.onTap,
    this.onLongPress,
  });
  final CodexThread thread;
  final HighlightColor highlightColor;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  String _getProjectName() {
    final parts = thread.cwd.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  String _formatDate(DateTime date) {
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
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    final status = sessionStatuses[thread.id];
    final isActive = status != null && (status.isBusy || status.isRetry);
    final color = highlightColor.forBrightness(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    final bgColor = highlightColor.backgroundFor(
      Theme.of(context).brightness,
      themePrimary: ocTheme.primary,
    );
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        decoration: BoxDecoration(color: bgColor, borderRadius: Radii.brMd),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar (highlight color)
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: color,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                ),
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title row with star + time/status
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Star icon inline
                        Icon(AppIcons.star, size: 16, color: color),
                        SizedBox(width: Spacing.sm),
                        Expanded(
                          child: Text(
                            thread.displayTitle,
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              height: 1.3,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        SizedBox(width: Spacing.md),
                        // Status or time
                        if (isActive)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: 10,
                                height: 10,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    status!.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                status.isRetry ? 'Retry' : 'Working',
                                style: TextStyle(
                                  color: status.isRetry
                                      ? ocTheme.warning
                                      : ocTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          )
                        else
                          Text(
                            _formatDate(thread.updatedAtDateTime),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Meta row: agent icon + project + model badge
                    Row(
                      children: [
                        // Codex icon
                        Icon(
                          AppIcons.autoAwesome,
                          size: 12,
                          color: ocTheme.primary,
                        ),
                        const SizedBox(width: 6),
                        // Project name
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        // Git branch if available
                        if (thread.gitBranch != null) ...[
                          Text(
                            ' · ',
                            style: TextStyle(
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
                              fontSize: 12,
                            ),
                          ),
                          Flexible(
                            child: Text(
                              thread.gitBranch!,
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 12,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        const Spacer(),
                        // Model badge if available
                        if (thread.modelProvider != null)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.info.withValues(alpha: 0.12),
                              borderRadius: Radii.brXs,
                            ),
                            child: Text(
                              thread.modelProvider!,
                              style: TextStyle(
                                color: ocTheme.info,
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Codex thread card
/// Matches OpenCode's _SessionCard design
class _CodexThreadCard extends ConsumerWidget {
  const _CodexThreadCard({
    required this.thread,
    required this.isHighlighted,
    required this.highlightColor,
    required this.onTap,
    this.onLongPress,
  });
  final CodexThread thread;
  final bool isHighlighted;
  final HighlightColor highlightColor;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  String _getProjectName() {
    final parts = thread.cwd.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  String _formatDate(DateTime date) {
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
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    final status = sessionStatuses[thread.id];
    final isActive = status != null && (status.isBusy || status.isRetry);
    // Accent color for left bar
    final accentColor = isActive
        ? (status!.isRetry ? ocTheme.warning : ocTheme.info)
        : ocTheme.primary.withValues(alpha: 0.4);
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brMd,
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: accentColor,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                ),
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title row with time/status
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            thread.displayTitle,
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              height: 1.3,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        SizedBox(width: Spacing.md),
                        // Status or time
                        if (isActive)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: 10,
                                height: 10,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    status!.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                status.isRetry ? 'Retry' : 'Working',
                                style: TextStyle(
                                  color: status.isRetry
                                      ? ocTheme.warning
                                      : ocTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          )
                        else
                          Text(
                            _formatDate(thread.updatedAtDateTime),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Meta row: agent icon + project + model badge
                    Row(
                      children: [
                        // Codex icon
                        Icon(
                          AppIcons.autoAwesome,
                          size: 12,
                          color: ocTheme.primary,
                        ),
                        const SizedBox(width: 6),
                        // Project name
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        // Git branch if available
                        if (thread.gitBranch != null) ...[
                          Text(
                            ' · ',
                            style: TextStyle(
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
                              fontSize: 12,
                            ),
                          ),
                          Flexible(
                            child: Text(
                              thread.gitBranch!,
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 12,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                        const Spacer(),
                        // Model badge if available
                        if (thread.modelProvider != null)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.info.withValues(alpha: 0.12),
                              borderRadius: Radii.brXs,
                            ),
                            child: Text(
                              thread.modelProvider!,
                              style: TextStyle(
                                color: ocTheme.info,
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CodexEmptyState extends StatelessWidget {
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
            child: Icon(AppIcons.autoAwesome, size: 48, color: ocTheme.primary),
          ),
          SizedBox(height: Spacing.xxl),
          Text(
            'No Codex threads',
            style: TextStyle(
              color: ocTheme.text,
              fontSize: 20,
              fontWeight: FontWeight.w600,
            ),
          ),
          SizedBox(height: Spacing.sm),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 40),
            child: Text(
              'Threads will appear here when you use Codex',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
              textAlign: TextAlign.center,
            ),
          ),
        ],
      ),
    );
  }
}

class _ClaudeCodeSessionsViewState
    extends ConsumerState<_ClaudeCodeSessionsView> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  Timer? _searchDebounce;
  @override
  void initState() {
    super.initState();
    // Load sessions on init
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(ccSessionsProvider.notifier).load();
    });
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      setState(() => _searchQuery = value.trim().toLowerCase());
    });
  }

  Future<void> _refresh() async {
    await ref.read(ccSessionsProvider.notifier).refresh();
    ref.invalidate(ccProjectsForSessionsProvider);
    await widget.onRefresh();
  }

  void _showTitleFiltersSheet(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController();
    DetailSheet.show(
      context: context,
      title: 'Title Filters',
      initialSize: 0.6,
      minSize: 0.3,
      maxSize: 0.85,
      child: Consumer(
        builder: (context, ref, _) {
          final filters = ref.watch(
            sessionsTitleExcludeFiltersProvider(AgentType.claudeCode),
          );
          final notifier = ref.read(
            sessionsTitleExcludeFiltersProvider(AgentType.claudeCode).notifier,
          );
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Hide sessions whose titles match any filter. Use `/regex/` for regex, otherwise it's a case-insensitive substring match.",
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
                ),
                SizedBox(height: Spacing.md),
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
                            borderRadius: Radii.brMd,
                            borderSide: BorderSide(color: ocTheme.borderSubtle),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: Radii.brMd,
                            borderSide: BorderSide(color: ocTheme.borderSubtle),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius: Radii.brMd,
                            borderSide: BorderSide(color: ocTheme.primary),
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
                        foregroundColor: ocTheme.selectedListItemText,
                        padding: const EdgeInsets.symmetric(
                          horizontal: 16,
                          vertical: 12,
                        ),
                        shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
                      ),
                      child: const Text('Add'),
                    ),
                  ],
                ),
                SizedBox(height: Spacing.md),
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
                                    ? AppIcons.code
                                    : AppIcons.textFields,
                                color: ocTheme.textMuted,
                              ),
                              title: Text(
                                f,
                                style: TextStyle(color: ocTheme.text),
                              ),
                              trailing: IconButton(
                                onPressed: () => notifier.removeAt(index),
                                icon: Icon(
                                  AppIcons.delete,
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
    final cwd = session.cwd;
    if (cwd.isNotEmpty) {
      final parts = cwd.split('/').where((p) => p.isNotEmpty).toList();
      final project = ProjectSummary(
        id: '',
        name: parts.isEmpty ? 'Project' : parts.last,
        path: cwd,
      );
      ref.read(selectionProvider.notifier).selectProject(project);
    }
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

  // Show options menu (highlight + stop + delete)
  Future<void> _showSessionOptions(ClaudeCodeSession session) async {
    final highlights = ref.read(highlightsProvider);
    final isHighlighted = highlights.isSessionHighlighted(session.id);
    final ocTheme = OpenCodeTheme.of(context);
    final highlightColor = highlights.color;
    await DetailSheet.show(
      context: context,
      title: session.displayTitle,
      initialSize: 0.4,
      minSize: 0.2,
      maxSize: 0.5,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Rename option
          ListTile(
            leading: Icon(AppIcons.edit, color: ocTheme.textMuted),
            title: Text('Rename', style: TextStyle(color: ocTheme.text)),
            subtitle: Text(
              'Set a custom session name',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _renameCCSession(session);
            },
          ),
          // Stop Session option
          ListTile(
            leading: Icon(AppIcons.stop, color: ocTheme.textMuted),
            title: Text('Stop Session', style: TextStyle(color: ocTheme.text)),
            subtitle: Text(
              'Force stop if stuck',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _stopCCSession(session);
            },
          ),
          // Options
          ListTile(
            leading: Icon(
              isHighlighted ? AppIcons.star : AppIcons.starOutline,
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
            leading: Icon(AppIcons.delete, color: ocTheme.error),
            title: Text('Delete', style: TextStyle(color: ocTheme.error)),
            onTap: () {
              Navigator.pop(context);
              _deleteSession(session);
            },
          ),
        ],
      ),
    );
  }

  /// Stop/abort a Claude Code session
  void _stopCCSession(ClaudeCodeSession session) {
    final bridge = ref.read(bridgeServiceProvider);
    final ocTheme = OpenCodeTheme.of(context);
    // Send abort to bridge
    bridge.ccAbort(session.id);
    // Show confirmation
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Stop signal sent to session'),
        backgroundColor: ocTheme.backgroundPanel,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  /// Rename a Claude Code session
  Future<void> _renameCCSession(ClaudeCodeSession session) async {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController(text: session.title ?? '');
    final name = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ocTheme.backgroundPanel,
        title: Text('Rename Session', style: TextStyle(color: ocTheme.text)),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: TextStyle(color: ocTheme.text),
          decoration: InputDecoration(
            hintText: 'Enter a new name',
            hintStyle: TextStyle(color: ocTheme.textMuted),
            filled: true,
            fillColor: ocTheme.backgroundElement,
            border: OutlineInputBorder(
              borderRadius: Radii.brSm,
              borderSide: BorderSide(color: ocTheme.border),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('Cancel', style: TextStyle(color: ocTheme.textMuted)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, controller.text.trim()),
            child: Text('Rename', style: TextStyle(color: ocTheme.primary)),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.isEmpty || !mounted) return;
    final bridge = ref.read(bridgeServiceProvider);
    final result = await bridge.ccRenameSession(
      session.id,
      name,
      cwd: session.cwd,
    );
    if (!mounted) return;
    if (result != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Renamed to "$name"'),
          backgroundColor: ocTheme.backgroundPanel,
          behavior: SnackBarBehavior.floating,
        ),
      );
      // Refresh sessions list
      _refresh();
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Failed to rename session'),
          backgroundColor: ocTheme.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final sessionsAsync = ref.watch(ccSessionsProvider);
    final filterCwd = ref.watch(ccSessionsFilterCwdProvider);
    final ccFilterProjects = ref.watch(ccFilterProjectsProvider);
    final ocTheme = OpenCodeTheme.of(context);
    final highlights = ref.watch(highlightsProvider);
    final highlightColor = highlights.color;
    final titleFilterCount = ref
        .watch(sessionsTitleExcludeFiltersProvider(AgentType.claudeCode))
        .length;
    final filterLabel = _filterLabel(
      selectedPath: filterCwd,
      projects: ccFilterProjects,
    );
    final theme = Theme.of(context);
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
                              AppIcons.refresh,
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
                              borderRadius: Radii.brMd,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  AppIcons.terminal,
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
                      SizedBox(height: Spacing.sm),
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
                              projectsProvider: ccFilterProjectsProvider,
                              onSelected: (path) {
                                ref
                                        .read(
                                          ccSessionsFilterCwdProvider.notifier,
                                        )
                                        .state =
                                    path;
                                ref.read(ccSessionsProvider.notifier).load();
                              },
                            ),
                          ),
                          SizedBox(width: Spacing.sm),
                          _TitleFiltersChip(
                            count: titleFilterCount,
                            onTap: () => _showTitleFiltersSheet(context),
                          ),
                        ],
                      ),
                      SizedBox(height: Spacing.md),
                      SessionsSearchBar(
                        controller: _searchController,
                        onChanged: _onSearchChanged,
                        hintText: 'Search Claude Code sessions...',
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
                          Icon(AppIcons.error, color: ocTheme.error, size: 48),
                          SizedBox(height: Spacing.lg),
                          Text(
                            'Failed to load sessions',
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          SizedBox(height: Spacing.sm),
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
                    sessionsTitleExcludeFiltersProvider(AgentType.claudeCode),
                  );
                  final sorted =
                      sessions
                          .where((s) => projectPathMatches(s.cwd, filterCwd))
                          .where(
                            (s) => titleFilters.isEmpty
                                ? true
                                : !sessionTitleMatchesExcludeFilters(
                                    s.displayTitle,
                                    titleFilters,
                                  ),
                          )
                          .where(
                            (s) => _searchQuery.isEmpty
                                ? true
                                : s.displayTitle.toLowerCase().contains(
                                    _searchQuery,
                                  ),
                          )
                          .toList()
                        ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
                  if (sorted.isEmpty) {
                    if (_searchQuery.isNotEmpty) {
                      return [
                        SliverFillRemaining(
                          child: Center(
                            child: Text(
                              'No sessions matching "$_searchQuery"',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 14,
                              ),
                            ),
                          ),
                        ),
                      ];
                    }
                    return [SliverFillRemaining(child: _CCEmptyState())];
                  }
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
                            padding: Insets.bottomMd,
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
            return Padding(
              padding: Insets.bottomMd,
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
/// Matches OpenCode's _HighlightedSessionCard design
class _CCHighlightedSessionCard extends ConsumerWidget {
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    final status = sessionStatuses[session.id];
    final isActive = status != null && (status.isBusy || status.isRetry);
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
        decoration: BoxDecoration(color: bgColor, borderRadius: Radii.brMd),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar (highlight color)
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: color,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                ),
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title row with star + time/status
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Star icon inline
                        Icon(AppIcons.star, size: 16, color: color),
                        SizedBox(width: Spacing.sm),
                        Expanded(
                          child: Text(
                            session.displayTitle,
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              height: 1.3,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (session.isSubagentSession) ...[
                          SizedBox(width: Spacing.xs),
                          Icon(
                            AppIcons.gitBranch,
                            size: 14,
                            color: ocTheme.info,
                          ),
                        ],
                        SizedBox(width: Spacing.md),
                        // Status or time
                        if (isActive)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: 10,
                                height: 10,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    status!.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                status.isRetry ? 'Retry' : 'Working',
                                style: TextStyle(
                                  color: status.isRetry
                                      ? ocTheme.warning
                                      : ocTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          )
                        else
                          Text(
                            _formatDate(session.updatedAt),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Meta row: agent icon + project + model badge
                    Row(
                      children: [
                        // Claude Code icon
                        Icon(
                          AppIcons.terminal,
                          size: 12,
                          color: ocTheme.accent,
                        ),
                        const SizedBox(width: 6),
                        // Project name
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        // Model badge if available
                        if (session.model != null) ...[
                          SizedBox(width: Spacing.sm),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.info.withValues(alpha: 0.12),
                              borderRadius: Radii.brXs,
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
                        // Message count if available
                        if (session.messageCount != null &&
                            session.messageCount! > 0) ...[
                          const Spacer(),
                          Text(
                            '${session.messageCount} msgs',
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ],
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
          borderRadius: Radii.brMd,
        ),
        child: Icon(
          AppIcons.delete,
          color: ocTheme.selectedListItemText,
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
/// Matches OpenCode's _SessionCard design
class _CCSessionCard extends ConsumerWidget {
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

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final sessionStatuses = ref.watch(globalSessionStatusProvider);
    final status = sessionStatuses[session.id];
    final isActive = status != null && (status.isBusy || status.isRetry);
    // Accent color for left bar
    final accentColor = isActive
        ? (status!.isRetry ? ocTheme.warning : ocTheme.info)
        : ocTheme.accent.withValues(alpha: 0.4);
    Widget card = GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brMd,
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            // Left accent bar
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: accentColor,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                ),
              ),
            ),
            // Main content
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title row with time/status
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            session.displayTitle,
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              height: 1.3,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (session.isSubagentSession) ...[
                          SizedBox(width: Spacing.xs),
                          Icon(
                            AppIcons.gitBranch,
                            size: 14,
                            color: ocTheme.info,
                          ),
                        ],
                        SizedBox(width: Spacing.md),
                        // Status or time
                        if (isActive)
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                width: 10,
                                height: 10,
                                child: CircularProgressIndicator(
                                  strokeWidth: 1.5,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    status!.isRetry
                                        ? ocTheme.warning
                                        : ocTheme.info,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                status.isRetry ? 'Retry' : 'Working',
                                style: TextStyle(
                                  color: status.isRetry
                                      ? ocTheme.warning
                                      : ocTheme.info,
                                  fontSize: 11,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                            ],
                          )
                        else
                          Text(
                            _formatDate(session.updatedAt),
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 12,
                            ),
                          ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    // Meta row: agent icon + project + model badge
                    Row(
                      children: [
                        // Claude Code icon
                        Icon(
                          AppIcons.terminal,
                          size: 12,
                          color: ocTheme.accent,
                        ),
                        const SizedBox(width: 6),
                        // Project name
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        // Model badge if available
                        if (session.model != null) ...[
                          SizedBox(width: Spacing.sm),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.info.withValues(alpha: 0.12),
                              borderRadius: Radii.brXs,
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
                        // Message count if available
                        if (session.messageCount != null &&
                            session.messageCount! > 0) ...[
                          const Spacer(),
                          Text(
                            '${session.messageCount} msgs',
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ],
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
          borderRadius: Radii.brMd,
        ),
        child: Icon(
          AppIcons.delete,
          color: ocTheme.selectedListItemText,
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
            padding: Insets.cardLg,
            decoration: BoxDecoration(
              color: ocTheme.accent.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(AppIcons.terminal, size: 48, color: ocTheme.accent),
          ),
          SizedBox(height: Spacing.xxl),
          Text(
            'No Claude Code sessions',
            style: TextStyle(
              color: ocTheme.text,
              fontSize: 20,
              fontWeight: FontWeight.w600,
            ),
          ),
          SizedBox(height: Spacing.sm),
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
          icon: Icon(AppIcons.back, color: ocTheme.text),
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
            padding: Insets.chip,
            decoration: BoxDecoration(
              color: ocTheme.accent.withValues(alpha: 0.15),
              borderRadius: Radii.brSm,
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(AppIcons.terminal, size: 12, color: ocTheme.accent),
                SizedBox(width: Spacing.xs),
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
        margin: Insets.bottomMd,
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: ocTheme.error.withValues(alpha: 0.1),
          borderRadius: Radii.brMd,
          border: Border.all(color: ocTheme.error.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            Icon(AppIcons.error, color: ocTheme.error, size: 20),
            SizedBox(width: Spacing.sm),
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
      margin: Insets.bottomMd,
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
                      color: isUser
                          ? ocTheme.selectedListItemText
                          : ocTheme.text,
                      fontSize: 15,
                      height: 1.4,
                    ),
                  ),
                  if (isStreaming) ...[
                    SizedBox(height: Spacing.xs),
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
            SizedBox(height: Spacing.sm),
            ...message.toolCalls.map((tool) => _CCToolCallCard(tool: tool)),
          ],
          // Token usage
          if (message.tokenUsage != null) ...[
            SizedBox(height: Spacing.xs),
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
      padding: Insets.cardXs,
      decoration: BoxDecoration(
        color: ocTheme.backgroundElement,
        borderRadius: Radii.brMd,
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
              borderRadius: Radii.brSm,
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
                  : Icon(AppIcons.check, size: 14, color: ocTheme.success),
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
                  SizedBox(height: Spacing.xxs),
                  Text(
                    _formatInput(tool.input),
                    style: AppTypography.codeSmall(color: ocTheme.textMuted),
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
            AppIcons.chatBubble,
            size: 48,
            color: ocTheme.textMuted.withValues(alpha: 0.5),
          ),
          SizedBox(height: Spacing.lg),
          Text(
            'Start a conversation',
            style: TextStyle(
              color: ocTheme.textMuted,
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          ),
          SizedBox(height: Spacing.xs),
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
                  borderRadius: Radii.brXxl,
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
            SizedBox(width: Spacing.sm),
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
                  isStreaming ? AppIcons.stop : AppIcons.arrowUp,
                  color: ocTheme.selectedListItemText,
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

// ============================================================================
// PI SESSIONS VIEW
// ============================================================================

class _PiSessionsView extends ConsumerStatefulWidget {
  const _PiSessionsView({required this.onRefresh});
  final Future<void> Function() onRefresh;
  @override
  ConsumerState<_PiSessionsView> createState() => _PiSessionsViewState();
}

class _PiSessionsViewState extends ConsumerState<_PiSessionsView> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  Timer? _searchDebounce;

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      setState(() => _searchQuery = value.trim().toLowerCase());
    });
  }

  Future<void> _refresh() async {
    ref.invalidate(piSessionsProvider(null));
    await widget.onRefresh();
  }

  void _openSession(PiSessionInfo session) {
    final cwd = session.cwd;
    if (cwd.isNotEmpty) {
      final parts = cwd.split('/').where((p) => p.isNotEmpty).toList();
      final project = ProjectSummary(
        id: '',
        name: parts.isEmpty ? 'Project' : parts.last,
        path: cwd,
      );
      ref.read(selectionProvider.notifier).selectProject(project);
    }
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => ChatScreen.pi(piSession: session)),
    );
  }

  void _openDraftCwd() async {
    final controller = TextEditingController();
    final cwd = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Open Pi in directory'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: '/absolute/path/to/project',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Open'),
          ),
        ],
      ),
    );
    controller.dispose();
    final path = (cwd ?? '').trim();
    if (path.isEmpty || !mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen.piDraft(cwd: path, title: path),
      ),
    );
  }

  void _deleteSession(PiSessionInfo session) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Delete Session?'),
        content: Text(
          'Are you sure you want to delete this Pi session? This action cannot be undone.',
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
    final piBridge = ref.read(piBridgeServiceProvider);
    try {
      await piBridge.deleteSession(
        sessionPath: session.path,
        projectPath: session.cwd,
      );
      ref.invalidate(piSessionsProvider(null));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Session deleted'),
          backgroundColor: OpenCodeTheme.of(context).backgroundPanel,
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to delete session: $e'),
          backgroundColor: OpenCodeTheme.of(context).error,
        ),
      );
    }
  }

  void _showTitleFiltersSheet(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController();
    DetailSheet.show(
      context: context,
      title: 'Title Filters',
      initialSize: 0.6,
      minSize: 0.3,
      maxSize: 0.85,
      child: Consumer(
        builder: (context, ref, _) {
          final filters = ref.watch(
            sessionsTitleExcludeFiltersProvider(AgentType.pi),
          );
          final notifier = ref.read(
            sessionsTitleExcludeFiltersProvider(AgentType.pi).notifier,
          );
          return Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "Hide sessions whose titles match any filter. Use `/regex/` for regex, otherwise it's a case-insensitive substring match.",
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
                ),
                SizedBox(height: Spacing.md),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: controller,
                        style: TextStyle(color: ocTheme.text, fontSize: 14),
                        decoration: InputDecoration(
                          hintText: 'e.g. test or /^debug/i',
                          hintStyle: TextStyle(color: ocTheme.textMuted),
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12,
                            vertical: 10,
                          ),
                          border: OutlineInputBorder(
                            borderRadius: Radii.brSm,
                            borderSide: BorderSide(color: ocTheme.borderSubtle),
                          ),
                        ),
                      ),
                    ),
                    SizedBox(width: Spacing.sm),
                    IconButton(
                      icon: Icon(AppIcons.add, color: ocTheme.primary),
                      onPressed: () {
                        final text = controller.text.trim();
                        if (text.isNotEmpty) {
                          notifier.add(text);
                          controller.clear();
                        }
                      },
                    ),
                  ],
                ),
                SizedBox(height: Spacing.md),
                if (filters.isEmpty)
                  Text(
                    'No filters yet',
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
                  ),
                ...filters.asMap().entries.map((entry) {
                  return ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      entry.value,
                      style: TextStyle(color: ocTheme.text),
                    ),
                    trailing: IconButton(
                      icon: Icon(
                        AppIcons.close,
                        size: 18,
                        color: ocTheme.error,
                      ),
                      onPressed: () => notifier.removeAt(entry.key),
                    ),
                  );
                }),
              ],
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    final sessionsAsync = ref.watch(piSessionsProvider(null));
    final filterCwd = ref.watch(piSessionsFilterCwdProvider);
    final piFilterProjects = ref.watch(piFilterProjectsProvider);
    final highlights = ref.watch(highlightsProvider);
    final titleFilterCount = ref
        .watch(sessionsTitleExcludeFiltersProvider(AgentType.pi))
        .length;
    final filterLabel = _filterLabel(
      selectedPath: filterCwd,
      projects: piFilterProjects,
    );

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
                              AppIcons.refresh,
                              color: ocTheme.textMuted,
                            ),
                            tooltip: 'Refresh',
                          ),
                          // Pi badge
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.primary.withValues(alpha: 0.15),
                              borderRadius: Radii.brMd,
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  AppIcons.autoAwesome,
                                  size: 14,
                                  color: ocTheme.primary,
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  'Pi',
                                  style: TextStyle(
                                    color: ocTheme.primary,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: Spacing.sm),
                      Text(
                        'Pi coding sessions',
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 14),
                      // Filter chips row
                      Row(
                        children: [
                          _FilterChipButton(
                            label: filterLabel,
                            onTap: () => _showProjectFilter(
                              context: context,
                              theme: theme,
                              selectedPath: filterCwd,
                              projectsProvider: piFilterProjectsProvider,
                              onSelected: (path) {
                                ref
                                        .read(
                                          piSessionsFilterCwdProvider.notifier,
                                        )
                                        .state =
                                    path;
                              },
                            ),
                          ),
                          SizedBox(width: Spacing.sm),
                          _TitleFiltersChip(
                            count: titleFilterCount,
                            onTap: () => _showTitleFiltersSheet(context),
                          ),
                          const Spacer(),
                          IconButton(
                            onPressed: _openDraftCwd,
                            icon: Icon(AppIcons.add, color: ocTheme.text),
                            tooltip: 'New session',
                          ),
                        ],
                      ),
                      const SizedBox(height: 14),
                      SessionsSearchBar(
                        controller: _searchController,
                        onChanged: _onSearchChanged,
                        hintText: 'Search Pi sessions...',
                      ),
                    ],
                  ),
                ),
              ),
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
                          Icon(AppIcons.error, color: ocTheme.error, size: 48),
                          SizedBox(height: Spacing.lg),
                          Text(
                            'Failed to load Pi sessions',
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          SizedBox(height: Spacing.sm),
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
                  // Apply title exclude filters
                  final titleFilters = ref.watch(
                    sessionsTitleExcludeFiltersProvider(AgentType.pi),
                  );
                  final filtered = sessions.where((s) {
                    // Project filter
                    if (filterCwd != null &&
                        !projectPathMatches(s.cwd, filterCwd)) {
                      return false;
                    }
                    // Title exclude filters
                    final title = (s.name ?? s.firstMessage).toLowerCase();
                    for (final filter in titleFilters) {
                      if (filter.startsWith('/') && filter.endsWith('/')) {
                        try {
                          final pattern = filter.substring(
                            1,
                            filter.length - 1,
                          );
                          if (RegExp(
                            pattern,
                            caseSensitive: false,
                          ).hasMatch(title)) {
                            return false;
                          }
                        } catch (_) {}
                      } else if (title.contains(filter.toLowerCase())) {
                        return false;
                      }
                    }
                    // Search query
                    if (_searchQuery.isNotEmpty &&
                        !title.contains(_searchQuery)) {
                      return false;
                    }
                    return true;
                  }).toList()..sort((a, b) => b.modified.compareTo(a.modified));

                  if (filtered.isEmpty) {
                    if (_searchQuery.isNotEmpty) {
                      return [
                        SliverFillRemaining(
                          child: Center(
                            child: Text(
                              'No sessions matching "$_searchQuery"',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 14,
                              ),
                            ),
                          ),
                        ),
                      ];
                    }
                    return [
                      SliverFillRemaining(
                        child: Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Container(
                                padding: Insets.cardLg,
                                decoration: BoxDecoration(
                                  color: ocTheme.primary.withValues(alpha: 0.1),
                                  shape: BoxShape.circle,
                                ),
                                child: Icon(
                                  AppIcons.autoAwesome,
                                  size: 48,
                                  color: ocTheme.primary,
                                ),
                              ),
                              SizedBox(height: Spacing.xxl),
                              Text(
                                'No Pi sessions',
                                style: TextStyle(
                                  color: ocTheme.text,
                                  fontSize: 20,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              SizedBox(height: Spacing.sm),
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 40,
                                ),
                                child: Text(
                                  'Tap + to start a new Pi session',
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
                    ];
                  }

                  return [
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate((context, index) {
                          final session = filtered[index];
                          final title = (session.name ?? '').trim().isNotEmpty
                              ? session.name!.trim()
                              : session.firstMessage.trim().isNotEmpty
                              ? session.firstMessage.trim()
                              : 'Session ${session.id}';
                          final isHighlighted = highlights.isSessionHighlighted(
                            session.id,
                          );
                          return Padding(
                            padding: Insets.bottomMd,
                            child: _PiSessionCard(
                              title: title,
                              session: session,
                              isHighlighted: isHighlighted,
                              onTap: () => _openSession(session),
                              onLongPress: () => _deleteSession(session),
                            ),
                          );
                        }, childCount: filtered.length),
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

class _PiSessionCard extends StatelessWidget {
  const _PiSessionCard({
    required this.title,
    required this.session,
    required this.isHighlighted,
    required this.onTap,
    this.onLongPress,
  });

  final String title;
  final PiSessionInfo session;
  final bool isHighlighted;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;

  String _getProjectName() {
    final parts = session.cwd.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Unknown' : parts.last;
  }

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${date.day}/${date.month}/${date.year}';
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: Radii.brMd,
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            Container(
              width: 3,
              decoration: BoxDecoration(
                color: ocTheme.primary.withValues(alpha: 0.4),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(10),
                  bottomLeft: Radius.circular(10),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            title,
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              height: 1.3,
                            ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        SizedBox(width: Spacing.md),
                        Text(
                          _formatDate(session.modified),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Icon(
                          AppIcons.autoAwesome,
                          size: 12,
                          color: ocTheme.primary,
                        ),
                        const SizedBox(width: 6),
                        Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                          ),
                        ),
                        const Spacer(),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.info.withValues(alpha: 0.12),
                            borderRadius: Radii.brXs,
                          ),
                          child: Text(
                            '${session.messageCount} msgs',
                            style: TextStyle(
                              color: ocTheme.info,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
