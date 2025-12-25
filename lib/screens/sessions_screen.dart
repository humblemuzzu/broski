import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/project.dart';
import '../models/session.dart';
import '../providers/chat_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/sessions_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
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
    await ref.read(sessionsListProvider.future);
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final theme = Theme.of(context);
    final filterProjectPath = ref.watch(sessionsFilterProjectPathProvider);
    final projectsAsync = ref.watch(projectsForSessionsProvider);
    final sessionsAsync = ref.watch(sessionsListProvider);

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
              SliverToBoxAdapter(
                child: _ModernHeader(
                  connection: connection,
                  filterProjectPath: filterProjectPath,
                  projects: projectsAsync,
                  onFilterChanged: (path) {
                    ref.read(sessionsFilterProjectPathProvider.notifier).state =
                        path;
                    ref.read(sessionsRefreshTickProvider.notifier).state++;
                  },
                  onRefresh: _refresh,
                ),
              ),
              ...sessionsAsync.when(
                loading: () => [
                  const SliverFillRemaining(
                    child: Center(child: CircularProgressIndicator()),
                  ),
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

                  final projectsByPath = <String, ProjectSummary>{};
                  for (final p
                      in projectsAsync.valueOrNull ??
                          const <ProjectSummary>[]) {
                    projectsByPath[p.path] = p;
                  }

                  final items = _buildListItems(
                    sessions: sessions,
                    projectsByPath: projectsByPath,
                    grouped: filterProjectPath == null,
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

                          final session = (item as _SessionListItem).session;
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: _SessionCard(
                              session: session,
                              isOfflineMode: connection.isOfflineMode,
                              onTap: () => _openSession(session),
                              onDelete: connection.isOfflineMode
                                  ? null
                                  : () => _deleteSession(session),
                              onRename: connection.isOfflineMode
                                  ? null
                                  : () => _showRenameDialog(session),
                            ),
                          );
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

List<_SessionRowItem> _buildListItems({
  required List<SessionSummary> sessions,
  required Map<String, ProjectSummary> projectsByPath,
  required bool grouped,
}) {
  String displayNameForDirectory(String directory) {
    final project = projectsByPath[directory];
    if (project != null && project.name.isNotEmpty) return project.name;
    final parts = directory.split('/').where((p) => p.isNotEmpty).toList();
    return parts.isEmpty ? 'Global' : parts.last;
  }

  if (!grouped) {
    return sessions.map((s) => _SessionListItem(s)).toList();
  }

  final groups = <String, List<SessionSummary>>{};
  for (final session in sessions) {
    groups.putIfAbsent(session.directory, () => []).add(session);
  }

  final directories = groups.keys.toList()
    ..sort((a, b) {
      final aMax = groups[a]!
          .map((s) => s.time.updated)
          .fold<int>(0, (prev, v) => v > prev ? v : prev);
      final bMax = groups[b]!
          .map((s) => s.time.updated)
          .fold<int>(0, (prev, v) => v > prev ? v : prev);
      return bMax.compareTo(aMax);
    });

  final items = <_SessionRowItem>[];
  for (final directory in directories) {
    items.add(_SessionListHeader(displayNameForDirectory(directory)));
    final group = groups[directory]!
      ..sort((a, b) => b.time.updated - a.time.updated);
    for (final session in group) {
      items.add(_SessionListItem(session));
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
  });

  final BridgeConnectionState connection;
  final String? filterProjectPath;
  final AsyncValue<List<ProjectSummary>> projects;
  final ValueChanged<String?> onFilterChanged;
  final VoidCallback onRefresh;

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
          Align(
            alignment: Alignment.centerLeft,
            child: _FilterChipButton(
              label: filterLabel,
              onTap: () => _showProjectFilter(
                context: context,
                theme: theme,
                selectedPath: filterProjectPath,
                projects: projects,
                onSelected: onFilterChanged,
              ),
            ),
          ),
        ],
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
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(18)),
    ),
    builder: (context) {
      final sheetOcTheme = OpenCodeTheme.of(context);
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'Filter sessions',
                      style: TextStyle(
                        color: sheetOcTheme.text,
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: Icon(
                      Icons.close_rounded,
                      color: sheetOcTheme.textMuted,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(
                  'All projects',
                  style: TextStyle(
                    color: sheetOcTheme.text,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                trailing: selectedPath == null
                    ? Icon(Icons.check_rounded, color: sheetOcTheme.success)
                    : null,
                onTap: () {
                  onSelected(null);
                  Navigator.pop(context);
                },
              ),
              const Divider(height: 16),
              projects.when(
                loading: () => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()),
                ),
                error: (error, _) => Padding(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                  child: Text(
                    'Failed to load projects: $error',
                    style: TextStyle(color: sheetOcTheme.textMuted),
                  ),
                ),
                data: (items) {
                  final sorted = items.toList()
                    ..sort(
                      (a, b) =>
                          a.name.toLowerCase().compareTo(b.name.toLowerCase()),
                    );
                  return ConstrainedBox(
                    constraints: const BoxConstraints(maxHeight: 420),
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: sorted.length,
                      itemBuilder: (context, index) {
                        final project = sorted[index];
                        final isSelected = selectedPath == project.path;
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          title: Text(
                            project.name,
                            style: TextStyle(
                              color: sheetOcTheme.text,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(
                            project.path,
                            style: TextStyle(
                              color: sheetOcTheme.textMuted,
                              fontSize: 12,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: isSelected
                              ? Icon(
                                  Icons.check_rounded,
                                  color: sheetOcTheme.success,
                                )
                              : null,
                          onTap: () {
                            onSelected(project.path);
                            Navigator.pop(context);
                          },
                        );
                      },
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      );
    },
  );
}

// Session card with swipe-to-delete and long-press to rename
class _SessionCard extends StatelessWidget {
  const _SessionCard({
    required this.session,
    required this.onTap,
    this.onDelete,
    this.onRename,
    this.isOfflineMode = false,
  });

  final SessionSummary session;
  final VoidCallback onTap;
  final VoidCallback? onDelete;
  final VoidCallback? onRename;
  final bool isOfflineMode;

  String _getProjectName() {
    return session.directory.split('/').where((item) => item.isNotEmpty).last;
  }

  IconData _getSessionIcon() {
    // You can customize based on session content
    final title = session.title.toLowerCase();
    if (title.contains('fix') || title.contains('bug')) {
      return Icons.bug_report_rounded;
    } else if (title.contains('design') || title.contains('ui')) {
      return Icons.palette_rounded;
    } else if (title.contains('build') || title.contains('create')) {
      return Icons.construction_rounded;
    } else if (title.contains('review') || title.contains('audit')) {
      return Icons.fact_check_rounded;
    } else if (title.contains('docs') || title.contains('read')) {
      return Icons.description_rounded;
    }
    return Icons.chat_bubble_rounded;
  }

  Color _getIconColor(BuildContext context) {
    // Generate color from session ID hash using theme colors
    final ocTheme = OpenCodeTheme.of(context);
    final hash = session.id.hashCode;
    final colors = [
      ocTheme.primary,
      ocTheme.secondary,
      ocTheme.accent,
      ocTheme.success,
      ocTheme.warning,
      ocTheme.info,
    ];
    return colors[hash.abs() % colors.length];
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
    final iconColor = _getIconColor(context);

    // Base card widget
    Widget card = GestureDetector(
      onTap: onTap,
      // Feature 5: Long press to rename (disabled in offline mode)
      onLongPress: onRename,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Row(
          children: [
            // Icon with colored background
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: iconColor.withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(_getSessionIcon(), color: iconColor, size: 22),
            ),
            const SizedBox(width: 14),
            // Session info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session.title,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(
                        Icons.folder_rounded,
                        size: 14,
                        color: ocTheme.textMuted,
                      ),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          _getProjectName(),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 13,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _formatDate(session.time.updated),
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            // Chevron
            Icon(
              Icons.chevron_right_rounded,
              color: ocTheme.textMuted.withValues(alpha: 0.5),
              size: 22,
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
