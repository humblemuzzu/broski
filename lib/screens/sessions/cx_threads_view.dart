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
    final label = filterLabel(
      selectedPath: filterCwd,
      projects: codexFilterProjects,
    );
    final expandedProjects = ref.watch(cxProjectExpandedProvider);
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
                        Row(
                          children: [
                            FilterChipButton(
                              label: label,
                              onTap: () => showProjectFilter(
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
                          ],
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
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              AppIcons.error,
                              color: ocTheme.error,
                              size: 48,
                            ),
                            const SizedBox(height: Spacing.lg),
                            Text(
                              'Failed to load threads',
                              style: TextStyle(
                                color: ocTheme.text,
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
                    // Predictive prefetching: preload messages for top 3 CX threads
                    WidgetsBinding.instance.addPostFrameCallback((_) {
                      prefetchTopCxThreads(ref, filtered);
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
                      return [
                        const SliverFillRemaining(child: CodexEmptyState()),
                      ];
                    }
                    final highlightedThreads = filtered
                        .where((t) => highlights.isSessionHighlighted(t.id))
                        .toList();
                    final regularThreads = filtered
                        .where((t) => !highlights.isSessionHighlighted(t.id))
                        .toList();
                    // Build grouped items for regular threads
                    final cxIsGrouped = filterCwd == null;
                    final cxGroupedItems = <Widget>[];
                    if (!cxIsGrouped) {
                      for (final t in regularThreads) {
                        cxGroupedItems.add(
                          Padding(
                            padding: Insets.bottomMd,
                            child: CodexThreadCard(
                              thread: t,
                              isHighlighted: highlights.isSessionHighlighted(
                                t.id,
                              ),
                              highlightColor: highlights.color,
                              onTap: () => _openThread(t),
                              onLongPress: () => _showThreadOptions(t),
                              onArchive: () => _archiveThread(t),
                            ),
                          ),
                        );
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
                        final isExpanded = expandedProjects.contains(directory);
                        final limit = isExpanded
                            ? group.length
                            : kSessionsPerProjectDefault;
                        final visible = group.take(limit);
                        for (final t in visible) {
                          cxGroupedItems.add(
                            Padding(
                              padding: Insets.bottomMd,
                              child: CodexThreadCard(
                                thread: t,
                                isHighlighted: highlights.isSessionHighlighted(
                                  t.id,
                                ),
                                highlightColor: highlights.color,
                                onTap: () => _openThread(t),
                                onLongPress: () => _showThreadOptions(t),
                                onArchive: () => _archiveThread(t),
                              ),
                            ),
                          );
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
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                        sliver: SliverList(
                          delegate: SliverChildBuilderDelegate(
                            (context, index) => cxGroupedItems[index],
                            childCount: cxGroupedItems.length,
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
