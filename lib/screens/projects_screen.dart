import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/project.dart';
import '../providers/chat_provider.dart';
import '../providers/connection_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import 'chat_screen.dart';

class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});

  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  late Future<List<ProjectSummary>> _projectsFuture;

  @override
  void initState() {
    super.initState();
    _projectsFuture = _loadProjects();
  }

  Future<List<ProjectSummary>> _loadProjects() {
    final bridge = ref.read(bridgeServiceProvider);
    return bridge.listProjects();
  }

  Future<void> _refresh() async {
    setState(() {
      _projectsFuture = _loadProjects();
    });
    await _projectsFuture;
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      body: SafeArea(
        child: FutureBuilder<List<ProjectSummary>>(
          future: _projectsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(
                child: CircularProgressIndicator(color: Color(0xFF3B82F6)),
              );
            }

            if (snapshot.hasError) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(
                      Icons.error_outline_rounded,
                      color: Color(0xFFEF4444),
                      size: 48,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Failed to load projects',
                      style: const TextStyle(
                        color: Color(0xFFE4E4E7),
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      '${snapshot.error}',
                      style: const TextStyle(
                        color: Color(0xFF71717A),
                        fontSize: 14,
                      ),
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
                      onAddProject: _showAddProject,
                    ),
                  ),

                  // OpenCode warning if not running
                  if (!connection.opencodeRunning)
                    SliverToBoxAdapter(
                      child: _OpenCodeWarning(
                        onStart: () => _startOpenCode(context),
                        onRefresh: _refresh,
                      ),
                    ),

                  // Recent Sessions section (if we have projects)
                  if (projects.isNotEmpty) ...[
                    const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.fromLTRB(20, 24, 20, 12),
                        child: Text(
                          'RECENT SESSIONS',
                          style: TextStyle(
                            color: Color(0xFF71717A),
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
                    const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.fromLTRB(20, 32, 20, 12),
                        child: Text(
                          'ALL REPOSITORIES',
                          style: TextStyle(
                            color: Color(0xFF71717A),
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
                              color: const Color(
                                0xFF71717A,
                              ).withValues(alpha: 0.5),
                            ),
                            const SizedBox(height: 16),
                            const Text(
                              'No projects found',
                              style: TextStyle(
                                color: Color(0xFFE4E4E7),
                                fontSize: 18,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 8),
                            const Text(
                              'Open a repository to get started',
                              style: TextStyle(
                                color: Color(0xFF71717A),
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
    final bridge = ref.read(bridgeServiceProvider);
    final selection = ref.read(selectionProvider.notifier);
    final chat = ref.read(chatSessionProvider.notifier);

    selection.selectProject(project);

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

  void _startOpenCode(BuildContext context) {
    final bridge = ref.read(bridgeServiceProvider);
    final theme = Theme.of(context);
    bridge.startOpenCode();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Starting OpenCode on your Mac...'),
        backgroundColor: theme.colorScheme.surface,
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
    required this.onAddProject,
  });

  final BridgeConnectionState connection;
  final VoidCallback onRefresh;
  final VoidCallback onAddProject;

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
                ),
              ),
              // Add project button
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
          // Connection status badge
          _ConnectionBadge(
            isConnected: connection.isConnected,
            opencodeRunning: connection.opencodeRunning,
          ),
        ],
      ),
    );
  }
}

// Connection status badge
class _ConnectionBadge extends StatelessWidget {
  const _ConnectionBadge({
    required this.isConnected,
    required this.opencodeRunning,
  });

  final bool isConnected;
  final bool opencodeRunning;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final statusColor = isConnected && opencodeRunning
        ? const Color(0xFF10B981)
        : theme.colorScheme.error;
    final statusText = isConnected && opencodeRunning
        ? 'Connected to OpenCode'
        : 'Not Connected';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.colorScheme.onSurface.withValues(alpha: 0.15),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: statusColor,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            statusText,
            style: TextStyle(
              color: statusColor,
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
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
                  color: const Color(0xFFEF4444).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(
                  Icons.warning_amber_rounded,
                  color: Color(0xFFEF4444),
                  size: 20,
                ),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'OpenCode Not Running',
                  style: TextStyle(
                    color: Color(0xFFE4E4E7),
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text(
            'Start OpenCode on your Mac or run `opencode serve` in terminal.',
            style: TextStyle(color: Color(0xFF9CA3AF), fontSize: 14),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: onStart,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF3B82F6),
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
                  foregroundColor: const Color(0xFFE4E4E7),
                  side: const BorderSide(color: Color(0xFF71717A)),
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
    // You can expand this based on project type
    return Icons.shopping_bag_rounded; // Default icon
  }

  Color _getIconColor() {
    // Generate color from project name hash
    final hash = project.name.hashCode;
    final colors = [
      const Color(0xFF3B82F6), // Blue
      const Color(0xFF8B5CF6), // Purple
      const Color(0xFFEC4899), // Pink
      const Color(0xFFF59E0B), // Amber
      const Color(0xFF10B981), // Green
    ];
    return colors[hash.abs() % colors.length];
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

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
                color: _getIconColor().withValues(alpha: 0.15),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(_getProjectIcon(), color: _getIconColor(), size: 24),
            ),
            const SizedBox(width: 16),
            // Project info
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    project.name,
                    style: const TextStyle(
                      color: Color(0xFFE4E4E7),
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '~/${project.path.split('/').last}',
                    style: const TextStyle(
                      color: Color(0xFF71717A),
                      fontSize: 13,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 10),
                  // Tags (placeholder - you can add real tech stack detection)
                  Wrap(
                    spacing: 6,
                    children: [
                      _TechBadge(label: 'Flutter'),
                      _TechBadge(label: 'Dart'),
                    ],
                  ),
                ],
              ),
            ),
            // Chevron
            const Icon(
              Icons.chevron_right_rounded,
              color: Color(0xFF71717A),
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
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF71717A).withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF9CA3AF),
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
              const Icon(
                Icons.account_tree_rounded,
                color: Color(0xFF71717A),
                size: 20,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  project.name,
                  style: const TextStyle(
                    color: Color(0xFFE4E4E7),
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              const Text(
                'Open',
                style: TextStyle(
                  color: Color(0xFF3B82F6),
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
