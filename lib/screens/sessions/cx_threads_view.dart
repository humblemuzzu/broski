import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/models/project.dart';
import 'package:broski/providers/codex_provider.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/sessions_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/screens/sheets/cx_new_thread_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/project_path_match.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/sessions/codex_active_threads_section.dart';
import 'package:broski/widgets/sessions/cx_highlighted_card.dart';
import 'package:broski/widgets/sessions/cx_thread_card.dart';
import 'package:broski/widgets/sessions/session_helpers.dart';
import 'package:broski/widgets/sessions/session_list_states.dart';
import 'package:broski/widgets/sessions/sessions_search_bar.dart';
import 'package:broski/widgets/sessions/sort_chip.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Codex threads view. Extracted from sessions_screen.dart.
class CodexThreadsView extends ConsumerStatefulWidget {
  const CodexThreadsView({super.key, required this.onRefresh});
  final Future<void> Function() onRefresh;
  @override
  ConsumerState<CodexThreadsView> createState() => CodexThreadsViewState();
}

class CodexThreadsViewState extends ConsumerState<CodexThreadsView> {
  // Sort order: 'createdAt' (default) or 'updatedAt'
  String _sortBy = 'createdAt';
  final _searchController = TextEditingController();
  String _searchQuery = '';
  Timer? _searchDebounce;
  bool _showSubagentThreads = false;
  final Set<String> _expandedParents = {};
  final _scrollController = ScrollController();
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(codexThreadsProvider.notifier).load();
    });
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _searchController.dispose();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 250), () {
      if (!mounted) return;
      setState(() => _searchQuery = value.trim().toLowerCase());
    });
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final pos = _scrollController.position;
    if (pos.pixels >= pos.maxScrollExtent - 200) {
      final notifier = ref.read(codexThreadsProvider.notifier);
      if (notifier.hasMore) {
        notifier.loadMore();
      }
    }
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
                const SizedBox(height: Spacing.md),
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
            leading: Icon(AppIcons.compress, color: ocTheme.text),
            title: Text('Compact', style: TextStyle(color: ocTheme.text)),
            subtitle: Text(
              'Free up context by summarizing older messages',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            onTap: () {
              Navigator.pop(context);
              _compactThread(thread);
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
                  showInfo(context, 'Rename failed: ${humanizeError(e)}');
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
        showInfo(context, 'Forked: ${forked.displayTitle}');
      }
    } catch (e) {
      if (mounted) {
        showInfo(context, 'Fork failed: ${humanizeError(e)}');
      }
    }
  }

  /// Stop/abort a Codex thread
  void _stopThread(CodexThread thread) {
    final bridge = ref.read(bridgeServiceProvider);
    // Send abort to bridge
    bridge.cxAbort(threadId: thread.id);
    // Show confirmation
    showSuccess(context, 'Stop signal sent to thread');
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
    final notifier = ref.read(codexThreadsProvider.notifier);
    final ok = await notifier.setThreadArchived(thread.id, archive: true);
    if (!mounted) return;

    if (ok) {
      showActionSnackBar(
        context,
        'Thread archived',
        actionLabel: 'Undo',
        onAction: () {
          notifier
              .setThreadArchived(thread.id, archive: false)
              .then((_) => widget.onRefresh());
        },
      );
    } else {
      showError(context, 'Failed to archive thread');
    }
  }

  void _compactThread(CodexThread thread) async {
    try {
      await ref
          .read(bridgeServiceProvider)
          .cxCompactThread(threadId: thread.id);
      if (mounted) {
        showSuccess(context, 'Thread compacted');
      }
    } catch (e) {
      if (mounted) {
        showInfo(context, 'Compact failed: ${humanizeError(e)}');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final theme = Theme.of(context);
    final threadsAsync = ref.watch(codexThreadsProvider);
    final highlights = ref.watch(highlightsProvider);
    final filterCwd = ref.watch(codexThreadsFilterCwdProvider);
    final codexFilterProjects = ref.watch(codexProjectsForThreadsProvider);
    final titleFilterCount = ref
        .watch(sessionsTitleExcludeFiltersProvider(AgentType.codex))
        .length;
    final label = filterLabel(
      selectedPath: filterCwd,
      projects: codexFilterProjects,
    );
    final expandedProjects = ref.watch(cxProjectExpandedProvider);
    final threadsNotifier = ref.read(codexThreadsProvider.notifier);
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
              onNearBottom: () => unawaited(threadsNotifier.loadMore()),
              child: CustomScrollView(
                controller: _scrollController,
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
                                  color: ocTheme.primary.withValues(
                                    alpha: 0.12,
                                  ),
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
                              const Spacer(),
                              IconButton(
                                onPressed: () => showNewCxThreadSheet(context),
                                icon: Icon(AppIcons.add, color: ocTheme.text),
                                tooltip: 'New thread',
                              ),
                            ],
                          ),
                          const SizedBox(height: Spacing.sm),
                          Text(
                            'Codex threads from app-server',
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
                                        codexProjectsForThreadsProvider,
                                    onSelected: (path) {
                                      ref
                                              .read(
                                                codexThreadsFilterCwdProvider
                                                    .notifier,
                                              )
                                              .state =
                                          path;
                                      ref
                                          .read(codexThreadsProvider.notifier)
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
                                Builder(
                                  builder: (context) {
                                    final allThreads =
                                        threadsAsync.valueOrNull ?? [];
                                    final subagentCount = allThreads
                                        .where(
                                          (t) =>
                                              t.agentNickname != null ||
                                              t.agentRole != null,
                                        )
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
                                        isExpanded: _showSubagentThreads,
                                        onTap: () => setState(() {
                                          _showSubagentThreads =
                                              !_showSubagentThreads;
                                          if (!_showSubagentThreads) {
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
                            hintText: 'Search Codex threads...',
                          ),
                        ],
                      ),
                    ),
                  ),
                  ...threadsAsync.when(
                    loading: () => [
                      const SliverToBoxAdapter(child: DelayedSkeletonList()),
                    ],
                    error: (error, _) => [
                      SliverFillRemaining(
                        hasScrollBody: false,
                        child: SessionListErrorCard(
                          title: 'Failed to load Codex threads',
                          error: error,
                          onRetry: () => unawaited(threadsNotifier.refresh()),
                        ),
                      ),
                    ],
                    data: (threads) {
                      final titleFilters = ref.watch(
                        sessionsTitleExcludeFiltersProvider(AgentType.codex),
                      );
                      // Filter but keep all threads for grouping
                      final filtered =
                          threads
                              .where(
                                (t) => projectPathMatches(t.cwd, filterCwd),
                              )
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

                      // Classify threads:
                      // - Root: no agentNickname/agentRole AND no forkedFromId
                      // - Fork children: have forkedFromId → group under parent
                      // - Collab children: have agentNickname/agentRole → flat when toggled
                      bool isChild(CodexThread t) =>
                          t.agentNickname != null ||
                          t.agentRole != null ||
                          (t.forkedFromId != null &&
                              t.forkedFromId!.isNotEmpty);

                      final rootThreads = filtered
                          .where((t) => !isChild(t))
                          .toList();

                      // Build fork children map (keyed by forkedFromId)
                      final forkChildMap = <String, List<CodexThread>>{};
                      for (final t in filtered.where(
                        (t) =>
                            t.forkedFromId != null &&
                            t.forkedFromId!.isNotEmpty,
                      )) {
                        forkChildMap
                            .putIfAbsent(t.forkedFromId!, () => [])
                            .add(t);
                      }

                      // Collab children (no forkedFromId, just agentNickname/agentRole)
                      final collabChildren = filtered
                          .where(
                            (t) =>
                                (t.agentNickname != null ||
                                    t.agentRole != null) &&
                                (t.forkedFromId == null ||
                                    t.forkedFromId!.isEmpty),
                          )
                          .toList();

                      // Predictive prefetching
                      WidgetsBinding.instance.addPostFrameCallback((_) {
                        prefetchTopCxThreads(ref, rootThreads);
                      });
                      if (rootThreads.isEmpty && collabChildren.isEmpty) {
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
                        return [
                          const SliverFillRemaining(child: CodexEmptyState()),
                        ];
                      }
                      final highlightedThreads = rootThreads
                          .where((t) => highlights.isSessionHighlighted(t.id))
                          .toList();
                      final regularThreads = rootThreads
                          .where((t) => !highlights.isSessionHighlighted(t.id))
                          .toList();

                      // Helper to add a thread card + optional fork children
                      void addThreadWithChildren(
                        List<Widget> items,
                        CodexThread thread,
                      ) {
                        items.add(
                          Padding(
                            padding: Insets.bottomMd,
                            child: CodexThreadCard(
                              thread: thread,
                              isHighlighted: highlights.isSessionHighlighted(
                                thread.id,
                              ),
                              highlightColor: highlights.color,
                              onTap: () => _openThread(thread),
                              onLongPress: () => _showThreadOptions(thread),
                              onArchive: () => _archiveThread(thread),
                            ),
                          ),
                        );
                        final forkChildren = forkChildMap[thread.id] ?? [];
                        if (_showSubagentThreads && forkChildren.isNotEmpty) {
                          final isExpanded = _expandedParents.contains(
                            thread.id,
                          );
                          items.add(
                            _CxChildExpandRow(
                              count: forkChildren.length,
                              label: 'fork',
                              isExpanded: isExpanded,
                              onTap: () => setState(() {
                                if (isExpanded) {
                                  _expandedParents.remove(thread.id);
                                } else {
                                  _expandedParents.add(thread.id);
                                }
                              }),
                            ),
                          );
                          if (isExpanded) {
                            for (final child in forkChildren) {
                              items.add(
                                Padding(
                                  padding: const EdgeInsets.only(
                                    left: 24,
                                    bottom: 8,
                                  ),
                                  child: _CxChildThreadCard(
                                    thread: child,
                                    onTap: () => _openThread(child),
                                  ),
                                ),
                              );
                            }
                          }
                        }
                      }

                      // Build grouped items
                      final cxIsGrouped = filterCwd == null;
                      final cxGroupedItems = <Widget>[];
                      if (!cxIsGrouped) {
                        for (final t in regularThreads) {
                          addThreadWithChildren(cxGroupedItems, t);
                        }
                      } else {
                        final groups = <String, List<CodexThread>>{};
                        for (final t in regularThreads) {
                          groups.putIfAbsent(t.cwd, () => []).add(t);
                        }
                        final directories = groups.keys.toList()
                          ..sort((a, b) {
                            final aMax = groups[a]!
                                .map((t) => t.updatedAt)
                                .fold<int>(0, (p, v) => v > p ? v : p);
                            final bMax = groups[b]!
                                .map((t) => t.updatedAt)
                                .fold<int>(0, (p, v) => v > p ? v : p);
                            return bMax.compareTo(aMax);
                          });
                        for (final directory in directories) {
                          final parts = directory
                              .split('/')
                              .where((p) => p.isNotEmpty)
                              .toList();
                          final name = parts.isEmpty ? 'Global' : parts.last;
                          cxGroupedItems.add(
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
                          final isExpanded = expandedProjects.contains(
                            directory,
                          );
                          final limit = isExpanded
                              ? group.length
                              : kSessionsPerProjectDefault;
                          final visible = group.take(limit);
                          for (final t in visible) {
                            addThreadWithChildren(cxGroupedItems, t);
                          }
                          final remaining = group.length - limit;
                          if (remaining > 0) {
                            cxGroupedItems.add(
                              LoadMoreButton(
                                remainingCount: remaining,
                                onTap: () => ref
                                    .read(cxProjectExpandedProvider.notifier)
                                    .expand(directory),
                              ),
                            );
                          }
                        }
                      }

                      // Collab agents section (no parent link, show flat)
                      if (_showSubagentThreads && collabChildren.isNotEmpty) {
                        cxGroupedItems.add(
                          Padding(
                            padding: const EdgeInsets.fromLTRB(4, 14, 4, 10),
                            child: Builder(
                              builder: (context) {
                                final ocTheme = OpenCodeTheme.of(context);
                                return Text(
                                  'COLLAB AGENTS',
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
                        for (final t in collabChildren) {
                          cxGroupedItems.add(
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: _CxChildThreadCard(
                                thread: t,
                                onTap: () => _openThread(t),
                              ),
                            ),
                          );
                        }
                      }

                      return [
                        if (highlightedThreads.isNotEmpty)
                          SliverToBoxAdapter(
                            child: CodexHighlightedThreadsSection(
                              threads: highlightedThreads,
                              highlightColor: highlights.color,
                              onTap: _openThread,
                              onLongPress: _showThreadOptions,
                            ),
                          ),
                        SliverPadding(
                          padding: const EdgeInsets.symmetric(horizontal: 20),
                          sliver: SliverList(
                            delegate: SliverChildBuilderDelegate(
                              (context, index) => cxGroupedItems[index],
                              childCount: cxGroupedItems.length,
                            ),
                          ),
                        ),
                        SliverToBoxAdapter(
                          child: Padding(
                            padding: const EdgeInsets.only(bottom: 100),
                            child: SessionListFooter(
                              hasMore: threadsNotifier.hasMore,
                              isLoading: threadsNotifier.isLoadingMore,
                              failed: threadsNotifier.loadMoreFailed,
                              onRetry: () =>
                                  unawaited(threadsNotifier.loadMore()),
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

class CodexHighlightedThreadsSection extends StatelessWidget {
  const CodexHighlightedThreadsSection({
    super.key,
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
              child: CodexHighlightedThreadCard(
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

class CodexEmptyState extends StatelessWidget {
  const CodexEmptyState({super.key});

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
          const SizedBox(height: Spacing.xxl),
          Text(
            'No Codex threads',
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

/// Expand/collapse row for Codex fork/collab children under a parent thread.
class _CxChildExpandRow extends StatelessWidget {
  const _CxChildExpandRow({
    required this.count,
    required this.label,
    required this.isExpanded,
    required this.onTap,
  });

  final int count;
  final String label;
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
            Icon(AppIcons.forkRight, size: 14, color: ocTheme.info),
            const SizedBox(width: 6),
            Text(
              '$count $label${count == 1 ? '' : 's'}',
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
              child: Icon(AppIcons.chevronRight, size: 14, color: ocTheme.info),
            ),
          ],
        ),
      ),
    );
  }
}

/// Compact card for Codex child threads (forks or collab agents).
class _CxChildThreadCard extends StatelessWidget {
  const _CxChildThreadCard({required this.thread, required this.onTap});

  final CodexThread thread;
  final VoidCallback onTap;

  String _formatDate(int timestampSec) {
    final date = DateTime.fromMillisecondsSinceEpoch(timestampSec * 1000);
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
    final title = thread.displayTitle;
    final stats = thread.summary;
    final hasStats =
        stats != null && (stats.additions > 0 || stats.deletions > 0);
    final isCollab = thread.agentNickname != null || thread.agentRole != null;
    final label = isCollab
        ? (thread.agentNickname ?? thread.agentRole ?? 'Agent')
        : 'Fork';
    final accentColor = isCollab ? ocTheme.warning : ocTheme.info;
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
                color: accentColor.withValues(alpha: 0.4),
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
                          label,
                          style: TextStyle(
                            color: accentColor,
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
                          _formatDate(thread.updatedAt),
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
                        if (thread.agentRole != null) ...[
                          const Spacer(),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: accentColor.withValues(alpha: 0.12),
                              borderRadius: Radii.brXs,
                            ),
                            child: Text(
                              thread.agentRole!,
                              style: TextStyle(
                                color: accentColor,
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
