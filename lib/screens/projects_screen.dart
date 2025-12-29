import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../models/project.dart';
import '../providers/agent_type_provider.dart';
import '../providers/chat_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import '../widgets/connection_quality_indicator.dart';
import 'chat_screen.dart';

class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});

  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  late Future<List<ProjectSummary>> _projectsFuture;
  late AgentType _agentType;
  late final ProviderSubscription<AgentType> _agentTypeSub;

  @override
  void initState() {
    super.initState();
    _agentType = ref.read(agentTypeProvider);
    _projectsFuture = _loadProjects(_agentType);

    _agentTypeSub = ref.listenManual<AgentType>(agentTypeProvider, (
      previous,
      next,
    ) {
      if (previous == next) return;
      if (!mounted) return;
      setState(() {
        _agentType = next;
        _projectsFuture = _loadProjects(next);
      });
    });
  }

  @override
  void dispose() {
    _agentTypeSub.close();
    super.dispose();
  }

  Future<List<ProjectSummary>> _loadProjects(AgentType agentType) async {
    final connection = ref.read(connectionProvider);
    final storage = ref.read(storageServiceProvider);

    // In offline mode, return cached projects
    if (connection.isOfflineMode && agentType == AgentType.opencode) {
      return storage.getCachedProjects();
    }

    // Try live data first, fallback to cache on failure
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final projects = agentType == AgentType.claudeCode
          ? await bridge.ccListProjects()
          : await bridge.listProjects();

      // Cache for offline use
      if (projects.isNotEmpty && agentType == AgentType.opencode) {
        await storage.cacheProjects(projects);
      }

      return projects;
    } catch (e) {
      // On any error (timeout, connection issues), try cached data
      if (agentType == AgentType.opencode) {
        final cached = await storage.getCachedProjects();
        if (cached.isNotEmpty) {
          // Return cached data silently - user can pull to refresh
          return cached;
        }
      }
      // No cached data available, rethrow to show error
      rethrow;
    }
  }

  Future<void> _refresh() async {
    setState(() {
      _projectsFuture = _loadProjects(_agentType);
    });
    await _projectsFuture;
  }

  @override
  Widget build(BuildContext context) {
    final agentType = ref.watch(agentTypeProvider);
    final connection = ref.watch(connectionProvider);
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: FutureBuilder<List<ProjectSummary>>(
          future: _projectsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return Center(
                child: CircularProgressIndicator(color: ocTheme.primary),
              );
            }

            if (snapshot.hasError) {
              return Center(
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
                      'Failed to load projects',
                      style: TextStyle(
                        color: ocTheme.text,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${snapshot.error}',
                      style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
              );
            }

            final projects = snapshot.data ?? [];

            return RefreshIndicator(
              onRefresh: _refresh,
              color: theme.colorScheme.primary,
              backgroundColor: theme.colorScheme.surface,
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  // Modern header
                  SliverToBoxAdapter(
                    child: _ModernHeader(
                      connection: connection,
                      onRefresh: _refresh,
                      onAddProject:
                          agentType == AgentType.opencode ? _showAddProject : null,
                    ),
                  ),

                  // OpenCode warning if not running
                  if (agentType == AgentType.opencode &&
                      !connection.opencodeRunning)
                    SliverToBoxAdapter(
                      child: _OpenCodeWarning(
                        onStart: () => _startOpenCode(context),
                        onRefresh: _refresh,
                      ),
                    ),

                  // Recent Sessions section (if we have projects)
                  if (agentType == AgentType.opencode && projects.isNotEmpty)
                    ...[
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
                        child: Text(
                          'RECENT SESSIONS',
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    ),
                    SliverToBoxAdapter(
                      child: _RecentSessions(
                        projects: projects.take(2).toList(),
                        onProjectTap: (project) =>
                            _openProject(context, project),
                      ),
                    ),
                  ],

                  // All Repositories section
                  if (projects.isNotEmpty) ...[
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(20, 32, 20, 12),
                        child: Text(
                          agentType == AgentType.claudeCode
                              ? 'CLAUDE PROJECTS'
                              : 'ALL REPOSITORIES',
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.5,
                          ),
                        ),
                      ),
                    ),
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate((context, index) {
                          final project = projects[index];
                          return _RepositoryListItem(
                            project: project,
                            onTap: () => _openProject(context, project),
                          );
                        }, childCount: projects.length),
                      ),
                    ),
                  ],

                  // Empty state
                  if (projects.isEmpty)
                    SliverFillRemaining(
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.folder_open_rounded,
                              size: 64,
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              'No projects found',
                              style: TextStyle(
                                color: ocTheme.text,
                                fontSize: 18,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'Open a repository to get started',
                              style: TextStyle(
                                color: ocTheme.textMuted,
                                fontSize: 14,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Future<void> _openProject(
    BuildContext context,
    ProjectSummary project,
  ) async {
    final currentAgentType = ref.read(agentTypeProvider);
    if (currentAgentType == AgentType.claudeCode) {
      await _openClaudeProject(context, project);
      return;
    }
    final connection = ref.read(connectionProvider);
    final selection = ref.read(selectionProvider.notifier);
    final chat = ref.read(chatSessionProvider.notifier);
    final storage = ref.read(storageServiceProvider);

    selection.selectProject(project);

    // In offline mode, try to find a cached session for this project
    if (connection.isOfflineMode) {
      final cachedSessions = await storage.getCachedSessions();
      final projectSessions = cachedSessions
          .where((s) => s.directory == project.path)
          .toList();

      if (projectSessions.isEmpty) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('No cached sessions for this project'),
            backgroundColor: Theme.of(context).colorScheme.surface,
            behavior: SnackBarBehavior.floating,
          ),
        );
        return;
      }

      // Use the most recent session
      projectSessions.sort((a, b) => b.time.updated - a.time.updated);
      final session = projectSessions.first;

      selection.selectSession(session);
      chat.setSession(session, projectPath: project.path);

      if (!mounted) return;
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ChatScreen(project: project, session: session),
        ),
      );
      return;
    }

    final bridge = ref.read(bridgeServiceProvider);
    final session = await bridge.createSession(
      projectPath: project.path,
      title: 'Mobile session',
    );

    selection.selectSession(session);
    chat.setSession(session, projectPath: project.path);

    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen(project: project, session: session),
      ),
    );
  }

  Future<void> _openClaudeProject(
    BuildContext context,
    ProjectSummary project,
  ) async {
    ref.read(selectionProvider.notifier).selectProject(project);

    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatScreen.claudeCodeDraft(
          cwd: project.path,
          title: project.name,
        ),
      ),
    );
  }

  Future<void> _startOpenCode(BuildContext context) async {
    final bridge = ref.read(bridgeServiceProvider);
    final messenger = ScaffoldMessenger.of(context);
    final surfaceColor = Theme.of(context).colorScheme.surface;

    messenger.showSnackBar(
      SnackBar(
        content: const Text('Restarting OpenCode...'),
        backgroundColor: surfaceColor,
        behavior: SnackBarBehavior.floating,
      ),
    );

    final ok = await bridge.restartOpenCode();
    if (!mounted) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text(ok ? 'OpenCode restarted' : 'Failed to restart OpenCode'),
        backgroundColor: surfaceColor,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _showAddProject() {
    final theme = Theme.of(context);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Add project - coming soon'),
        backgroundColor: theme.colorScheme.surface,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }
}

// Modern header with title and add button
class _ModernHeader extends StatelessWidget {
  const _ModernHeader({
    required this.connection,
    required this.onRefresh,
    this.onAddProject,
  });

  final BridgeConnectionState connection;
  final VoidCallback onRefresh;
  final VoidCallback? onAddProject;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'Projects',
                  style: TextStyle(
                    color: theme.colorScheme.onSurface,
                    fontSize: 32,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              // Add project button
              if (onAddProject != null)
                GestureDetector(
                  onTap: onAddProject,
                  child: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(
                        color: theme.colorScheme.onSurface.withValues(
                          alpha: 0.15,
                        ),
                      ),
                    ),
                    child: Icon(
                      Icons.create_new_folder_rounded,
                      color: theme.colorScheme.onSurface,
                      size: 24,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'Select a repo to start vibe coding',
            style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              fontSize: 15,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 20),
          // Connection quality indicator with signal bars
          const ConnectionQualityIndicator(),
        ],
      ),
    );
  }
}

// OpenCode warning card
class _OpenCodeWarning extends StatelessWidget {
  const _OpenCodeWarning({required this.onStart, required this.onRefresh});

  final VoidCallback onStart;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);

    return Container(
      margin: const EdgeInsets.fromLTRB(20, 20, 20, 0),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: theme.colorScheme.error.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: ocTheme.error.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(
                  Icons.warning_amber_rounded,
                  color: ocTheme.error,
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'OpenCode Not Running',
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Start OpenCode on your Mac or run `opencode serve` in terminal.',
            style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: onStart,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: ocTheme.primary,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                  ),
                  child: const Text(
                    'Start OpenCode',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              OutlinedButton(
                onPressed: onRefresh,
                style: OutlinedButton.styleFrom(
                  foregroundColor: ocTheme.text,
                  side: BorderSide(color: ocTheme.textMuted),
                  padding: const EdgeInsets.symmetric(
                    vertical: 12,
                    horizontal: 20,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
                child: const Text(
                  'Refresh',
                  style: TextStyle(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// Recent sessions with rich cards
class _RecentSessions extends StatelessWidget {
  const _RecentSessions({required this.projects, required this.onProjectTap});

  final List<ProjectSummary> projects;
  final void Function(ProjectSummary) onProjectTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: Column(
        children: projects.map((project) {
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _SessionCard(
              project: project,
              onTap: () => onProjectTap(project),
            ),
          );
        }).toList(),
      ),
    );
  }
}

// Rich session card
class _SessionCard extends StatelessWidget {
  const _SessionCard({required this.project, required this.onTap});

  final ProjectSummary project;
  final VoidCallback onTap;

  IconData _getProjectIcon() {
    return Icons.shopping_bag_rounded;
  }

  Color _getIconColor(OpenCodeTheme theme) {
    final hash = project.name.hashCode;
    final colors = [theme.primary, theme.info, theme.warning, theme.success];
    return colors[hash.abs() % colors.length];
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final iconColor = _getIconColor(ocTheme);

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.1),
          ),
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
              child: Icon(_getProjectIcon(), color: iconColor, size: 24),
            ),
            const SizedBox(width: 16),
            // Project info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    project.name,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '~/${project.path.split('/').last}',
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 10),
                  // Tags
                  Wrap(
                    spacing: 6,
                    children: const [
                      _TechBadge(label: 'Flutter'),
                      _TechBadge(label: 'Dart'),
                    ],
                  ),
                ],
              ),
            ),
            // Chevron
            Icon(
              Icons.chevron_right_rounded,
              color: ocTheme.textMuted,
              size: 24,
            ),
          ],
        ),
      ),
    );
  }
}

// Tech badge
class _TechBadge extends StatelessWidget {
  const _TechBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: ocTheme.textMuted.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: ocTheme.textMuted,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

// Simple repository list item
class _RepositoryListItem extends StatelessWidget {
  const _RepositoryListItem({required this.project, required this.onTap});

  final ProjectSummary project;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Icon(
                Icons.account_tree_rounded,
                color: ocTheme.textMuted,
                size: 20,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  project.name,
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                'Open',
                style: TextStyle(
                  color: ocTheme.primary,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
