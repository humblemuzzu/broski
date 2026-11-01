import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/claude_code_provider.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/screens/sheets/cc_new_session_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/project_path_match.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/sessions/cc_highlighted_card.dart';
import 'package:broski/widgets/sessions/cc_session_card.dart';
import 'package:broski/widgets/sessions/session_helpers.dart';
import 'package:broski/widgets/sessions/session_list_states.dart';
import 'package:broski/widgets/sessions/sessions_search_bar.dart';
import 'package:broski/widgets/sessions/sort_chip.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Claude Code sessions view. Extracted from sessions_screen.dart.
class CCActiveSessionsSection extends ConsumerWidget {
  const CCActiveSessionsSection({super.key, this.onSessionTap});
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
              const SizedBox(width: Spacing.md),
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
          const SizedBox(height: Spacing.md),
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
                      const SizedBox(width: Spacing.md),
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
                            const SizedBox(height: Spacing.xxs),
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
                                  const SizedBox(width: Spacing.sm),
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

class ClaudeCodeSessionsView extends ConsumerStatefulWidget {
  const ClaudeCodeSessionsView({super.key});
  @override
  ConsumerState<ClaudeCodeSessionsView> createState() =>
      ClaudeCodeSessionsViewState();
}

class ClaudeCodeSessionsViewState
    extends ConsumerState<ClaudeCodeSessionsView> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  String _sortBy = 'updatedAt';
  bool _showSubagentSessions = false;
  final Set<String> _expandedParents = {};
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
                const SizedBox(height: Spacing.md),
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
                const SizedBox(height: Spacing.md),
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
    if (success) {
      showSuccess(context, 'Session deleted');
    } else {
      showError(context, 'Failed to delete session');
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
    // Claude Code subagents are finished transcripts — the CC SDK exposes
    // listSubagents()/getSubagentMessages() for reading but has no API to
    // continue a subagent. Open them in read-only mode so the input bar
    // hides and nothing tries to mutate live state.
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen.claudeCode(
          ccSession: session,
          readOnly: session.isSubagentSession,
        ),
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
            leading: Icon(AppIcons.forkRight, color: ocTheme.textMuted),
            title: Text('Fork', style: TextStyle(color: ocTheme.text)),
            subtitle: Text(
              'Create a copy of this session',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _forkCCSession(session);
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
    // Send abort to bridge
    bridge.ccAbort(session.id);
    // Show confirmation
    showSuccess(context, 'Stop signal sent to session');
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
      showSuccess(context, 'Renamed to "$name"');
      // Refresh sessions list
      _refresh();
    } else {
      showError(context, 'Failed to rename session');
    }
  }

  /// Fork a Claude Code session
  Future<void> _forkCCSession(ClaudeCodeSession session) async {
    final bridge = ref.read(bridgeServiceProvider);
    try {
      final forked = await bridge.ccForkSession(session.id, cwd: session.cwd);
      if (!mounted) return;
      if (forked != null) {
        showSuccess(context, 'Forked: ${forked.displayTitle}');
        _refresh();
      }
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Fork failed: ${humanizeError(e)}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final sessionsAsync = ref.watch(ccSessionsProvider);
    final filterCwd = ref.watch(ccSessionsFilterCwdProvider);
    final ccFilterProjects = ref.watch(ccProjectsForSessionsProvider);
    final expandedProjects = ref.watch(ccProjectExpandedProvider);
    final ocTheme = OpenCodeTheme.of(context);
    final highlights = ref.watch(highlightsProvider);
    final highlightColor = highlights.color;
    final titleFilterCount = ref
        .watch(sessionsTitleExcludeFiltersProvider(AgentType.claudeCode))
        .length;
    final label = filterLabel(
      selectedPath: filterCwd,
      projects: ccFilterProjects,
    );
    final theme = Theme.of(context);
    final sessionsNotifier = ref.read(ccSessionsProvider.notifier);
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: AdaptiveContainer(
          width: ContentWidth.standard,
          child: RefreshIndicator(
            onRefresh: _refresh,
            color: theme.colorScheme.primary,
            backgroundColor: theme.colorScheme.surface,
            child: SessionListScrollTrigger(
              onNearBottom: () => unawaited(sessionsNotifier.loadMore()),
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  // Active sessions (busy/retry)
                  SliverToBoxAdapter(
                    child: CCActiveSessionsSection(onSessionTap: _openSession),
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
                                onPressed: () => showNewCCSessionSheet(context),
                                icon: Icon(AppIcons.add, color: ocTheme.text),
                                tooltip: 'New session',
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
                          const SizedBox(height: Spacing.sm),
                          Text(
                            'Claude Code sessions from ~/.claude',
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 15,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                          const SizedBox(height: 14),
                          SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: Row(
                              children: [
                                FilterChipButton(
                                  label: label,
                                  onTap: () => showProjectFilter(
                                    context: context,
                                    theme: theme,
                                    selectedPath: filterCwd,
                                    projectsProvider:
                                        ccProjectsForSessionsProvider,
                                    onSelected: (path) {
                                      ref
                                              .read(
                                                ccSessionsFilterCwdProvider
                                                    .notifier,
                                              )
                                              .state =
                                          path;
                                      ref
                                          .read(ccSessionsProvider.notifier)
                                          .load();
                                    },
                                  ),
                                ),
                                const SizedBox(width: Spacing.sm),
                                TitleFiltersChip(
                                  count: titleFilterCount,
                                  onTap: () => _showTitleFiltersSheet(context),
                                ),
                                const SizedBox(width: Spacing.sm),
                                SortChip(
                                  sortBy: _sortBy,
                                  onChanged: (value) {
                                    setState(() => _sortBy = value);
                                  },
                                ),
                                // Subagent sessions filter
                                Builder(
                                  builder: (context) {
                                    final allSessions =
                                        ref
                                            .watch(ccSessionsProvider)
                                            .valueOrNull ??
                                        const <ClaudeCodeSession>[];
                                    final subagentCount = allSessions
                                        .where((s) => s.isSubagentSession)
                                        .length;
                                    if (subagentCount == 0) {
                                      return const SizedBox.shrink();
                                    }
                                    return Padding(
                                      padding: const EdgeInsets.only(
                                        left: Spacing.sm,
                                      ),
                                      child: BackgroundTasksChip(
                                        count: subagentCount,
                                        isExpanded: _showSubagentSessions,
                                        onTap: () => setState(() {
                                          _showSubagentSessions =
                                              !_showSubagentSessions;
                                          if (!_showSubagentSessions) {
                                            _expandedParents.clear();
                                          }
                                        }),
                                        onLongPress: () =>
                                            ref
                                                    .read(
                                                      showTasksTabProvider
                                                          .notifier,
                                                    )
                                                    .state =
                                                true,
                                      ),
                                    );
                                  },
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: Spacing.md),
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
                      const SliverToBoxAdapter(child: DelayedSkeletonList()),
                    ],
                    error: (error, _) => [
                      SliverFillRemaining(
                        hasScrollBody: false,
                        child: SessionListErrorCard(
                          title: 'Failed to load Claude Code sessions',
                          error: error,
                          onRetry: () => unawaited(sessionsNotifier.refresh()),
                        ),
                      ),
                    ],
                    data: (sessions) {
                      if (sessions.isEmpty) {
                        return [
                          const SliverFillRemaining(child: CCEmptyState()),
                        ];
                      }
                      final titleFilters = ref.watch(
                        sessionsTitleExcludeFiltersProvider(
                          AgentType.claudeCode,
                        ),
                      );
                      // Filter by project, title, search — but keep ALL sessions for grouping
                      final filtered =
                          sessions
                              .where(
                                (s) => projectPathMatches(s.cwd, filterCwd),
                              )
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
                            ..sort((a, b) {
                              if (_sortBy == 'updatedAt') {
                                return b.updatedAt.compareTo(a.updatedAt);
                              }
                              return b.createdAt.compareTo(a.createdAt);
                            });

                      // Separate root sessions from subagent children
                      final rootSessions = filtered
                          .where((s) => !s.isSubagentSession)
                          .toList();
                      final childMap = <String, List<ClaudeCodeSession>>{};
                      for (final s in filtered.where(
                        (s) => s.isSubagentSession,
                      )) {
                        if (s.parentSessionId != null) {
                          childMap
                              .putIfAbsent(s.parentSessionId!, () => [])
                              .add(s);
                        }
                      }

                      // Predictive prefetching: preload messages for top 3 CC sessions
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        prefetchTopCCSessions(ref, rootSessions);
                      });
                      if (rootSessions.isEmpty) {
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
                          const SliverFillRemaining(child: CCEmptyState()),
                        ];
                      }
                      // Separate highlighted and regular sessions
                      final highlightedSessions = rootSessions
                          .where((s) => highlights.isSessionHighlighted(s.id))
                          .toList();
                      final regularSessions = rootSessions
                          .where((s) => !highlights.isSessionHighlighted(s.id))
                          .toList();

                      // Helper to add a session card + optional children
                      void addSessionWithChildren(
                        List<Widget> items,
                        ClaudeCodeSession session,
                      ) {
                        items.add(
                          Padding(
                            padding: Insets.bottomMd,
                            child: CCSessionCard(
                              session: session,
                              onTap: () => _openSession(session),
                              onLongPress: () => _showSessionOptions(session),
                              onDelete: () => _deleteSession(session),
                            ),
                          ),
                        );
                        final children = childMap[session.id] ?? [];
                        if (_showSubagentSessions && children.isNotEmpty) {
                          final isExpanded = _expandedParents.contains(
                            session.id,
                          );
                          items.add(
                            _CCChildExpandRow(
                              count: children.length,
                              isExpanded: isExpanded,
                              onTap: () => setState(() {
                                if (isExpanded) {
                                  _expandedParents.remove(session.id);
                                } else {
                                  _expandedParents.add(session.id);
                                }
                              }),
                            ),
                          );
                          if (isExpanded) {
                            for (final child in children) {
                              items.add(
                                Padding(
                                  padding: const EdgeInsets.only(
                                    left: 24,
                                    bottom: 8,
                                  ),
                                  child: _CCChildSessionCard(
                                    session: child,
                                    onTap: () => _openSession(child),
                                  ),
                                ),
                              );
                            }
                          }
                        }
                      }

                      return [
                        // Highlighted Sessions Section
                        if (highlightedSessions.isNotEmpty)
                          SliverToBoxAdapter(
                            child: CCHighlightedSessionsSection(
                              sessions: highlightedSessions,
                              highlightColor: highlightColor,
                              onTap: _openSession,
                              onLongPress: _showSessionOptions,
                              onDelete: _deleteSession,
                            ),
                          ),
                        // Regular Sessions (grouped by project when no filter)
                        (() {
                          final isGrouped = filterCwd == null;
                          final ccItems = <Widget>[];
                          if (!isGrouped) {
                            for (final session in regularSessions) {
                              addSessionWithChildren(ccItems, session);
                            }
                          } else {
                            // Group by project directory
                            final groups = <String, List<ClaudeCodeSession>>{};
                            for (final s in regularSessions) {
                              groups.putIfAbsent(s.cwd, () => []).add(s);
                            }
                            final directories = groups.keys.toList()
                              ..sort((a, b) {
                                final aMax = groups[a]!
                                    .map((s) => s.updatedAt)
                                    .fold<int>(0, (p, v) => v > p ? v : p);
                                final bMax = groups[b]!
                                    .map((s) => s.updatedAt)
                                    .fold<int>(0, (p, v) => v > p ? v : p);
                                return bMax.compareTo(aMax);
                              });
                            for (final directory in directories) {
                              final parts = directory
                                  .split('/')
                                  .where((p) => p.isNotEmpty)
                                  .toList();
                              final name = parts.isEmpty
                                  ? 'Global'
                                  : parts.last;
                              ccItems.add(
                                Padding(
                                  padding: const EdgeInsets.fromLTRB(
                                    4,
                                    14,
                                    4,
                                    10,
                                  ),
                                  child: Builder(
                                    builder: (context) {
                                      final ocT = OpenCodeTheme.of(context);
                                      return Text(
                                        name.toUpperCase(),
                                        style: TextStyle(
                                          color: ocT.textMuted,
                                          fontSize: 12,
                                          fontWeight: FontWeight.w700,
                                          letterSpacing: 0.5,
                                        ),
                                      );
                                    },
                                  ),
                                ),
                              );
                              final group = groups[directory]!;
                              final isExpanded = expandedProjects.contains(
                                directory,
                              );
                              final limit = isExpanded
                                  ? group.length
                                  : kSessionsPerProjectDefault;
                              final visible = group.take(limit);
                              for (final session in visible) {
                                addSessionWithChildren(ccItems, session);
                              }
                              final remaining = group.length - limit;
                              if (remaining > 0) {
                                ccItems.add(
                                  LoadMoreButton(
                                    remainingCount: remaining,
                                    onTap: () => ref
                                        .read(
                                          ccProjectExpandedProvider.notifier,
                                        )
                                        .expand(directory),
                                  ),
                                );
                              }
                            }
                          }
                          return SliverPadding(
                            padding: const EdgeInsets.symmetric(horizontal: 20),
                            sliver: SliverList(
                              delegate: SliverChildBuilderDelegate(
                                (context, index) => ccItems[index],
                                childCount: ccItems.length,
                              ),
                            ),
                          );
                        })(),
                        SliverToBoxAdapter(
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 100),
                            child: SessionListFooter(
                              hasMore: sessionsNotifier.hasMore,
                              isLoading: sessionsNotifier.isLoadingMore,
                              failed: sessionsNotifier.loadMoreFailed,
                              onRetry: () =>
                                  unawaited(sessionsNotifier.loadMore()),
                            ),
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
      ),
    );
  }
}

class CCHighlightedSessionsSection extends StatelessWidget {
  const CCHighlightedSessionsSection({
    super.key,
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
              child: CCHighlightedSessionCard(
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

class CCEmptyState extends StatelessWidget {
  const CCEmptyState({super.key});

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
          const SizedBox(height: Spacing.xxl),
          Text(
            'No Claude Code sessions',
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

/// Expand/collapse row for CC subagent children under a parent session.
class _CCChildExpandRow extends StatelessWidget {
  const _CCChildExpandRow({
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
    return GestureDetector(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.only(left: 16, top: 4, bottom: 8),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.forkRight, size: 14, color: ocTheme.accent),
            const SizedBox(width: 6),
            Text(
              '$count subagent${count == 1 ? '' : 's'}',
              style: TextStyle(
                color: ocTheme.accent,
                fontSize: 12,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(width: 4),
            AnimatedRotation(
              turns: isExpanded ? 0.25 : 0,
              duration: const Duration(milliseconds: 200),
              child: Icon(
                AppIcons.chevronRight,
                size: 14,
                color: ocTheme.accent,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Compact card for CC subagent child sessions.
class _CCChildSessionCard extends StatelessWidget {
  const _CCChildSessionCard({required this.session, required this.onTap});

  final ClaudeCodeSession session;
  final VoidCallback onTap;

  String _formatDate(int timestampMs) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestampMs);
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
    final title = session.displayTitle;
    final stats = session.summary;
    final hasStats =
        stats != null && (stats.additions > 0 || stats.deletions > 0);
    final agentLabel = session.subagentName ?? 'Subagent';
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
            Container(
              width: 2,
              decoration: BoxDecoration(
                color: ocTheme.accent.withValues(alpha: 0.4),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(8),
                  bottomLeft: Radius.circular(8),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          agentLabel,
                          style: TextStyle(
                            color: ocTheme.accent,
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            title,
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
                    const SizedBox(height: Spacing.xs),
                    Row(
                      children: [
                        Text(
                          _formatDate(session.updatedAt),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 11,
                          ),
                        ),
                        if (hasStats) ...[
                          Text(
                            ' · ',
                            style: TextStyle(
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
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
                            const SizedBox(width: 4),
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
                        if (session.model != null) ...[
                          const Spacer(),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: ocTheme.accent.withValues(alpha: 0.12),
                              borderRadius: Radii.brXs,
                            ),
                            child: Text(
                              session.model!,
                              style: TextStyle(
                                color: ocTheme.accent,
                                fontSize: 10,
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
            ),
          ],
        ),
      ),
    );
  }
}
