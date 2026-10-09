import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/pi.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/screens/sessions/pi/pi_tool_subagents_section.dart';
import 'package:broski/screens/sessions/pi_active_sessions_section.dart';
import 'package:broski/screens/sessions/pi_highlighted_sessions_section.dart';
import 'package:broski/screens/sessions/pi_new_session.dart';
import 'package:broski/screens/sessions/pi_session_options_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/project_path_match.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/sessions/pi_session_card.dart';
import 'package:broski/widgets/sessions/session_helpers.dart';
import 'package:broski/widgets/sessions/sessions_search_bar.dart';
import 'package:broski/widgets/sessions/sort_chip.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Pi sessions view. Extracted from sessions_screen.dart.
class PiSessionsView extends ConsumerStatefulWidget {
  const PiSessionsView({super.key, required this.onRefresh});
  final Future<void> Function() onRefresh;
  @override
  ConsumerState<PiSessionsView> createState() => PiSessionsViewState();
}

class PiSessionsViewState extends ConsumerState<PiSessionsView> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  Timer? _searchDebounce;
  String _sortBy = 'updatedAt';
  bool _showChildSessions = false;
  final Set<String> _expandedParents = {};

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

  void _showNewSessionSheet() {
    DetailSheet.show(
      context: context,
      title: 'New Pi Session',
      initialSize: 0.6,
      maxSize: 0.9,
      child: PiNewSessionContent(
        onSelectProject: (path, name) {
          Navigator.pop(context);
          ref
              .read(selectionProvider.notifier)
              .selectProject(ProjectSummary(id: '', name: name, path: path));
          Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => ChatScreen.piDraft(cwd: path, title: name),
            ),
          );
        },
      ),
    );
  }

  void _deleteSession(PiSessionInfo session) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: Theme.of(context).colorScheme.surface,
        title: const Text('Delete Session?'),
        content: const Text(
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
      showSuccess(context, 'Session deleted');
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to delete session: $e');
    }
  }

  void _showSessionOptions(PiSessionInfo session) {
    final title = (session.name ?? '').trim().isNotEmpty
        ? session.name!.trim()
        : session.firstMessage.trim().isNotEmpty
        ? session.firstMessage.trim()
        : 'Session ${session.id}';
    showPiSessionOptionsSheet(
      context: context,
      ref: ref,
      session: session,
      displayTitle: title,
      onDeleted: () => _refresh(),
      onRenamed: () => _refresh(),
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
                const SizedBox(height: Spacing.md),
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
                    const SizedBox(width: Spacing.sm),
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
                const SizedBox(height: Spacing.md),
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

  String _sessionTitle(PiSessionInfo session) {
    if ((session.name ?? '').trim().isNotEmpty) return session.name!.trim();
    if (session.firstMessage.trim().isNotEmpty) {
      return session.firstMessage.trim();
    }
    return 'Session ${session.id}';
  }

  Widget _buildChildExpandRow(
    String parentPath,
    int count,
    bool isExpanded, {
    int toolCount = 0,
  }) {
    final totalCount = count + toolCount;
    return GestureDetector(
      onTap: () => setState(() {
        if (isExpanded) {
          _expandedParents.remove(parentPath);
        } else {
          _expandedParents.add(parentPath);
        }
      }),
      child: Padding(
        padding: const EdgeInsets.only(left: 16, top: 4, bottom: 8),
        child: Builder(
          builder: (context) {
            final ocTheme = OpenCodeTheme.of(context);
            return Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(AppIcons.forkRight, size: 14, color: ocTheme.info),
                const SizedBox(width: 6),
                Text(
                  '$totalCount subagent${totalCount == 1 ? '' : 's'}',
                  style: TextStyle(
                    color: ocTheme.info,
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
                    color: ocTheme.info,
                  ),
                ),
              ],
            );
          },
        ),
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
    final allPiSessions = sessionsAsync.valueOrNull ?? [];
    final handoffChildCount = allPiSessions
        .where(
          (s) => s.parentSessionPath != null && s.parentSessionPath!.isNotEmpty,
        )
        .length;
    final toolSubagentCount = allPiSessions.fold<int>(
      0,
      (sum, s) => sum + (s.subagentToolCount ?? 0),
    );
    final childSessionCount = handoffChildCount + toolSubagentCount;
    final label = filterLabel(
      selectedPath: filterCwd,
      projects: piFilterProjects,
    );

    final expandedProjects = ref.watch(piProjectExpandedProvider);
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
              // Active sessions (busy/retry) - parity with CC
              SliverToBoxAdapter(
                child: PiActiveSessionsSection(onSessionTap: _openSession),
              ),
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
                      const SizedBox(height: Spacing.sm),
                      Text(
                        'Pi coding sessions',
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 14),
                      // Filter chips row — scrollable horizontally
                      Row(
                        children: [
                          Expanded(
                            child: SingleChildScrollView(
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
                                          piFilterProjectsProvider,
                                      onSelected: (path) {
                                        ref
                                                .read(
                                                  piSessionsFilterCwdProvider
                                                      .notifier,
                                                )
                                                .state =
                                            path;
                                      },
                                    ),
                                  ),
                                  const SizedBox(width: Spacing.sm),
                                  TitleFiltersChip(
                                    count: titleFilterCount,
                                    onTap: () =>
                                        _showTitleFiltersSheet(context),
                                  ),
                                  const SizedBox(width: Spacing.sm),
                                  SortChip(
                                    sortBy: _sortBy,
                                    onChanged: (value) {
                                      setState(() => _sortBy = value);
                                    },
                                  ),
                                  if (childSessionCount > 0) ...[
                                    const SizedBox(width: Spacing.sm),
                                    BackgroundTasksChip(
                                      count: childSessionCount,
                                      isExpanded: _showChildSessions,
                                      onTap: () => setState(() {
                                        _showChildSessions =
                                            !_showChildSessions;
                                        if (!_showChildSessions) {
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
                                  ],
                                ],
                              ),
                            ),
                          ),
                          IconButton(
                            onPressed: _showNewSessionSheet,
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
                  const SliverToBoxAdapter(child: DelayedSkeletonList()),
                ],
                error: (error, _) => [
                  SliverFillRemaining(
                    child: Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(AppIcons.error, color: ocTheme.error, size: 48),
                          const SizedBox(height: Spacing.lg),
                          Text(
                            'Failed to load Pi sessions',
                            style: TextStyle(
                              color: ocTheme.text,
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: Spacing.sm),
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
                  final filtered =
                      sessions.where((s) {
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
                      }).toList()..sort((a, b) {
                        if (_sortBy == 'updatedAt') {
                          return b.modified.compareTo(a.modified);
                        }
                        return b.created.compareTo(a.created);
                      });
                  // Predictive prefetching: preload messages for top 3 Pi sessions
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    prefetchTopPiSessions(ref, filtered);
                  });

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
                              const SizedBox(height: Spacing.xxl),
                              Text(
                                'No Pi sessions',
                                style: TextStyle(
                                  color: ocTheme.text,
                                  fontSize: 20,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: Spacing.sm),
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

                  // Separate highlighted and regular sessions
                  final highlightedSessions = filtered
                      .where((s) => highlights.isSessionHighlighted(s.id))
                      .toList();
                  final regularSessions = filtered
                      .where((s) => !highlights.isSessionHighlighted(s.id))
                      .toList();

                  // Separate root sessions from handoff children
                  final rootRegular = regularSessions
                      .where((s) => s.parentSessionPath == null)
                      .toList();
                  final childMap = <String, List<PiSessionInfo>>{};
                  for (final c in regularSessions.where(
                    (s) => s.parentSessionPath != null,
                  )) {
                    childMap.putIfAbsent(c.parentSessionPath!, () => []).add(c);
                  }

                  // Build grouped items
                  final piIsGrouped = filterCwd == null;
                  final piGroupedItems = <Widget>[];
                  if (!piIsGrouped) {
                    for (final session in rootRegular) {
                      final title = _sessionTitle(session);
                      final isHighlighted = highlights.isSessionHighlighted(
                        session.id,
                      );
                      final children = childMap[session.path] ?? [];
                      final toolCount = session.subagentToolCount ?? 0;
                      final hasAnyChildren =
                          _showChildSessions &&
                          (children.isNotEmpty || toolCount > 0);
                      final isExpanded = _expandedParents.contains(
                        session.path,
                      );
                      piGroupedItems.add(
                        Padding(
                          padding: Insets.bottomMd,
                          child: PiSessionCard(
                            title: title,
                            session: session,
                            isHighlighted: isHighlighted,
                            onTap: () => _openSession(session),
                            onLongPress: () => _showSessionOptions(session),
                            onDelete: () => _deleteSession(session),
                          ),
                        ),
                      );
                      if (hasAnyChildren) {
                        piGroupedItems.add(
                          _buildChildExpandRow(
                            session.path,
                            children.length,
                            isExpanded,
                            toolCount: toolCount,
                          ),
                        );
                        if (isExpanded) {
                          for (final child in children) {
                            piGroupedItems.add(
                              Padding(
                                padding: const EdgeInsets.only(
                                  left: 24,
                                  bottom: 8,
                                ),
                                child: _PiChildSessionCard(
                                  session: child,
                                  onTap: () => _openSession(child),
                                ),
                              ),
                            );
                          }
                          // Lazy-load tool subagents (Task, oracle, finder, etc.)
                          if (toolCount > 0) {
                            piGroupedItems.add(
                              PiToolSubagentsSection(
                                sessionId: session.id,
                                cwd: session.cwd,
                              ),
                            );
                          }
                        }
                      }
                    }
                  } else {
                    final groups = <String, List<PiSessionInfo>>{};
                    for (final s in rootRegular) {
                      groups.putIfAbsent(s.cwd, () => []).add(s);
                    }
                    final directories = groups.keys.toList()
                      ..sort((a, b) {
                        final aMax = groups[a]!
                            .map((s) => s.modified.millisecondsSinceEpoch)
                            .fold<int>(0, (p, v) => v > p ? v : p);
                        final bMax = groups[b]!
                            .map((s) => s.modified.millisecondsSinceEpoch)
                            .fold<int>(0, (p, v) => v > p ? v : p);
                        return bMax.compareTo(aMax);
                      });
                    for (final directory in directories) {
                      final parts = directory
                          .split('/')
                          .where((p) => p.isNotEmpty)
                          .toList();
                      final name = parts.isEmpty ? 'Global' : parts.last;
                      piGroupedItems.add(
                        Padding(
                          padding: const EdgeInsets.fromLTRB(4, 14, 4, 10),
                          child: Builder(
                            builder: (context) {
                              final ocTheme = OpenCodeTheme.of(context);
                              return Text(
                                name.toUpperCase(),
                                style: TextStyle(
                                  color: ocTheme.textMuted,
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
                      final isExpanded = expandedProjects.contains(directory);
                      final limit = isExpanded
                          ? group.length
                          : kSessionsPerProjectDefault;
                      final visible = group.take(limit);
                      for (final session in visible) {
                        final title = _sessionTitle(session);
                        final isHighlighted = highlights.isSessionHighlighted(
                          session.id,
                        );
                        final children = childMap[session.path] ?? [];
                        final toolCount = session.subagentToolCount ?? 0;
                        final hasAnyChildren =
                            _showChildSessions &&
                            (children.isNotEmpty || toolCount > 0);
                        final isChildExpanded = _expandedParents.contains(
                          session.path,
                        );
                        piGroupedItems.add(
                          Padding(
                            padding: Insets.bottomMd,
                            child: PiSessionCard(
                              title: title,
                              session: session,
                              isHighlighted: isHighlighted,
                              onTap: () => _openSession(session),
                              onLongPress: () => _showSessionOptions(session),
                              onDelete: () => _deleteSession(session),
                            ),
                          ),
                        );
                        if (hasAnyChildren) {
                          piGroupedItems.add(
                            _buildChildExpandRow(
                              session.path,
                              children.length,
                              isChildExpanded,
                              toolCount: toolCount,
                            ),
                          );
                          if (isChildExpanded) {
                            for (final child in children) {
                              piGroupedItems.add(
                                Padding(
                                  padding: const EdgeInsets.only(
                                    left: 24,
                                    bottom: 8,
                                  ),
                                  child: _PiChildSessionCard(
                                    session: child,
                                    onTap: () => _openSession(child),
                                  ),
                                ),
                              );
                            }
                            // Lazy-load tool subagents
                            if (toolCount > 0) {
                              piGroupedItems.add(
                                PiToolSubagentsSection(
                                  sessionId: session.id,
                                  cwd: session.cwd,
                                ),
                              );
                            }
                          }
                        }
                      }
                      final remaining = group.length - limit;
                      if (remaining > 0) {
                        piGroupedItems.add(
                          LoadMoreButton(
                            remainingCount: remaining,
                            onTap: () => ref
                                .read(piProjectExpandedProvider.notifier)
                                .expand(directory),
                          ),
                        );
                      }
                    }
                  }

                  return [
                    // Highlighted Sessions Section
                    if (highlightedSessions.isNotEmpty)
                      SliverToBoxAdapter(
                        child: PiHighlightedSessionsSection(
                          sessions: highlightedSessions,
                          highlightColor: highlights.color,
                          onTap: _openSession,
                          onLongPress: _showSessionOptions,
                          onDelete: _deleteSession,
                        ),
                      ),
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (context, index) => piGroupedItems[index],
                          childCount: piGroupedItems.length,
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
    );
  }
}

/// Compact card for Pi child/handoff sessions.
/// Mirrors [ChildSessionCard] but uses [PiSessionInfo].
class _PiChildSessionCard extends StatelessWidget {
  const _PiChildSessionCard({required this.session, required this.onTap});

  final PiSessionInfo session;
  final VoidCallback onTap;

  String _formatDate(DateTime date) {
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${date.day}/${date.month}/${date.year}';
  }

  String _getTitle() {
    if ((session.name ?? '').trim().isNotEmpty) {
      return session.name!.trim();
    }
    if (session.firstMessage.trim().isNotEmpty) {
      return session.firstMessage.trim();
    }
    return 'Handoff session';
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final title = _getTitle();
    final stats = session.summary;
    final hasStats =
        stats != null && (stats.additions > 0 || stats.deletions > 0);
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
                color: ocTheme.info.withValues(alpha: 0.4),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(8),
                  bottomLeft: Radius.circular(8),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 10, 10, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Text(
                          'Handoff',
                          style: TextStyle(
                            color: ocTheme.info,
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
                          _formatDate(session.modified),
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

// _PiToolSubagentsSection extracted to pi/pi_tool_subagents_section.dart
// (touch-it-move-it: this file was > 1000 lines and had to shrink).
