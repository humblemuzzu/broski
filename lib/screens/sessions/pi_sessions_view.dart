import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/agent_type.dart';
import '../../models/pi.dart';
import '../../models/project.dart';
import '../../providers/highlights_provider.dart';
import '../../providers/pi_provider.dart';
import '../../providers/selection_provider.dart';
import '../../providers/sessions_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../utils/project_path_match.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../widgets/sessions/pi_session_card.dart';
import '../../widgets/sessions/session_helpers.dart';
import '../../widgets/sessions/sort_chip.dart';
import '../../widgets/sessions/sessions_search_bar.dart';
import '../chat_screen.dart';
import 'pi_new_session.dart';
import 'pi_session_options_sheet.dart';
import 'pi_active_sessions_section.dart';
import 'pi_highlighted_sessions_section.dart';

/// Pi sessions view. Extracted from sessions_screen.dart.
class PiSessionsView extends ConsumerStatefulWidget {
  const PiSessionsView({required this.onRefresh});
  final Future<void> Function() onRefresh;
  @override
  ConsumerState<PiSessionsView> createState() => PiSessionsViewState();
}

class PiSessionsViewState extends ConsumerState<PiSessionsView> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  Timer? _searchDebounce;
  String _sortBy = 'updatedAt';

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
                          FilterChipButton(
                            label: label,
                            onTap: () => showProjectFilter(
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
                          TitleFiltersChip(
                            count: titleFilterCount,
                            onTap: () => _showTitleFiltersSheet(context),
                          ),
                          SizedBox(width: Spacing.sm),
                          SortChip(
                            sortBy: _sortBy,
                            onChanged: (value) {
                              setState(() => _sortBy = value);
                            },
                          ),
                          const Spacer(),
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
                  SliverToBoxAdapter(child: DelayedSkeletonList()),
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

                  // Separate highlighted and regular sessions
                  final highlightedSessions = filtered
                      .where((s) => highlights.isSessionHighlighted(s.id))
                      .toList();
                  final regularSessions = filtered
                      .where((s) => !highlights.isSessionHighlighted(s.id))
                      .toList();

                  // Build grouped items
                  final piIsGrouped = filterCwd == null;
                  final piGroupedItems = <Widget>[];
                  if (!piIsGrouped) {
                    for (final session in regularSessions) {
                      final title = (session.name ?? '').trim().isNotEmpty
                          ? session.name!.trim()
                          : session.firstMessage.trim().isNotEmpty
                          ? session.firstMessage.trim()
                          : 'Session ${session.id}';
                      final isHighlighted = highlights.isSessionHighlighted(
                        session.id,
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
                    }
                  } else {
                    final groups = <String, List<PiSessionInfo>>{};
                    for (final s in regularSessions) {
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
                        final title = (session.name ?? '').trim().isNotEmpty
                            ? session.name!.trim()
                            : session.firstMessage.trim().isNotEmpty
                            ? session.firstMessage.trim()
                            : 'Session ${session.id}';
                        final isHighlighted = highlights.isSessionHighlighted(
                          session.id,
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
