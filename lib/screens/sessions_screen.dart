import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../models/agent_type.dart';

import '../models/claude_code.dart';
import '../models/highlight_color.dart';
import '../models/permission_rule.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../models/worktree.dart';
import '../providers/agent_type_provider.dart';
import '../providers/chat_provider.dart';
import '../providers/claude_code_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/highlights_provider.dart';
import '../providers/permission_rules_provider.dart';
import '../providers/sessions_provider.dart';
import '../providers/service_providers.dart';
import '../providers/selection_provider.dart';
import '../providers/tool_settings_provider.dart';
import '../theme/opencode_theme.dart';
import '../widgets/background_session_widgets.dart';
import '../widgets/chat/detail_sheet.dart';
import '../widgets/sessions/sessions_search_bar.dart';
import '../widgets/sessions/archive_filter_chip.dart';
import 'chat_screen.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
import '../utils/error_utils.dart';
import 'sessions/cc_sessions_view.dart';
import 'sessions/cx_threads_view.dart';
import 'sessions/new_session_content.dart';
import 'sessions/pi_sessions_view.dart';
import '../widgets/sessions/child_session_card.dart';
import '../widgets/sessions/highlighted_card.dart';
import '../widgets/sessions/session_card.dart';
import '../widgets/sessions/session_helpers.dart';
import 'package:broski/utils/snackbar_helpers.dart';

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
                    SliverToBoxAdapter(child: DelayedSkeletonList()),
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
                      return [SliverFillRemaining(child: SessionsEmptyState())];
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
          ListTile(
            leading: Icon(AppIcons.forkRight, color: ocTheme.textMuted),
            title: Text('Fork', style: TextStyle(color: ocTheme.text)),
            subtitle: Text(
              'Create a copy of this session',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _forkSession(session);
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
              SizedBox(width: Spacing.sm),
              TitleFiltersChip(
                count: titleFilterCount,
                onTap: onTitleFiltersTap,
              ),
              SizedBox(width: Spacing.sm),
              // Background tasks toggle
              if (backgroundTaskCount > 0)
                BackgroundTasksChip(
                  count: backgroundTaskCount,
                  isExpanded: showBackgroundTasks,
                  onTap: onToggleBackgroundTasks,
                ),
              SizedBox(width: Spacing.sm),
              const ArchiveFilterChip(),
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
  const _CCDisplayMessage({
    required this.role,
    this.text = '',
    this.toolCalls = const [],
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
