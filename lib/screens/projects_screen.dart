import 'package:broski/models/agent_type.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/selected_backend.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/selected_backend_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/dialogs/project_context_menu.dart';
import 'package:broski/screens/projects/contract_projects.dart'
    show ProjectsSource, loadContractProjects, projectsSourceProvider;
import 'package:broski/screens/projects/open_project.dart';
import 'package:broski/screens/sheets/add_project_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/link/link_status_indicator.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});
  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  late Future<List<ProjectSummary>> _projectsFuture;
  late AgentType _agentType;
  late final ProviderSubscription<ProjectsSource> _agentTypeSub;
  @override
  void initState() {
    super.initState();
    _agentType = ref.read(agentTypeProvider);
    _projectsFuture = _loadProjects(_agentType);
    _agentTypeSub = ref.listenManual<ProjectsSource>(projectsSourceProvider, (
      previous,
      next,
    ) {
      if (previous == next) return;
      if (!mounted) return;
      setState(() {
        _agentType = ref.read(agentTypeProvider);
        _projectsFuture = _loadProjects(_agentType);
      });
    });
  }

  @override
  void dispose() {
    _agentTypeSub.close();
    super.dispose();
  }

  Future<List<ProjectSummary>> _loadProjects(AgentType agentType) async {
    if (ref.read(selectedBackendProvider) case ContractSelection(:final id)) {
      return loadContractProjects(ref, id);
    }
    final connection = ref.read(connectionProvider);
    final storage = ref.read(storageServiceProvider);
    if (connection.isOfflineMode) {
      return storage.getCachedCCProjects();
    }
    // Live data first, the cache when the bridge cannot be reached.
    try {
      final projects = await ref.read(bridgeServiceProvider).ccListProjects();
      if (projects.isNotEmpty) {
        await storage.cacheCCProjects(projects);
      }
      return projects;
    } catch (e) {
      final cached = await storage.getCachedCCProjects();
      if (cached.isNotEmpty) return cached;
      rethrow;
    }
  }

  Future<void> _refresh() async {
    setState(() {
      _projectsFuture = _loadProjects(_agentType);
    });
    await _projectsFuture;
  }

  Future<void> _showProjectContextMenu(ProjectSummary project) async {
    final shouldRefresh = await showProjectContextMenu(
      context: context,
      ref: ref,
      project: project,
    );
    if (shouldRefresh && mounted) {
      await _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final highlights = ref.watch(highlightsProvider);
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: Colors.transparent,
      body: SafeArea(
        child: AdaptiveContainer(
          width: ContentWidth.standard,
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
                      Icon(AppIcons.error, color: ocTheme.error, size: 48),
                      const SizedBox(height: Spacing.lg),
                      Text(
                        'Failed to load projects',
                        style: TextStyle(
                          color: ocTheme.text,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: Spacing.sm),
                      Text(
                        '${snapshot.error}',
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 14,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                );
              }
              final projects = snapshot.data ?? [];
              // Separate highlighted and non-highlighted projects
              final highlightedProjects = projects
                  .where((p) => highlights.isProjectHighlighted(p.id))
                  .toList();
              final regularProjects = projects
                  .where((p) => !highlights.isProjectHighlighted(p.id))
                  .toList();
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
                        onAddProject: connection.isOfflineMode
                            ? null
                            : _showAddProject,
                      ),
                    ),
                    // Highlighted Projects section
                    if (highlightedProjects.isNotEmpty) ...[
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(20, 24, 20, 12),
                          child: Row(
                            children: [
                              Icon(
                                AppIcons.star,
                                size: 14,
                                color: highlights.color.forBrightness(
                                  theme.brightness,
                                  themePrimary: ocTheme.primary,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                'HIGHLIGHTED',
                                style: TextStyle(
                                  color: highlights.color.forBrightness(
                                    theme.brightness,
                                    themePrimary: ocTheme.primary,
                                  ),
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  letterSpacing: 0.5,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      SliverPadding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
                        sliver: SliverList(
                          delegate: SliverChildBuilderDelegate((
                            context,
                            index,
                          ) {
                            final project = highlightedProjects[index];
                            return Padding(
                              padding: Insets.bottomSm,
                              child: _HighlightedProjectCard(
                                project: project,
                                highlightColor: highlights.color,
                                onTap: () => _openProject(context, project),
                                onLongPress: () =>
                                    _showProjectContextMenu(project),
                              ),
                            );
                          }, childCount: highlightedProjects.length),
                        ),
                      ),
                    ],
                    // All Repositories section
                    if (regularProjects.isNotEmpty) ...[
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(20, 32, 20, 12),
                          child: Text(
                            'CLAUDE PROJECTS',
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
                          delegate: SliverChildBuilderDelegate((
                            context,
                            index,
                          ) {
                            final project = regularProjects[index];
                            return _ProjectItem(
                              project: project,
                              onTap: () => _openProject(context, project),
                              onLongPress: () =>
                                  _showProjectContextMenu(project),
                            );
                          }, childCount: regularProjects.length),
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
                                AppIcons.folderOpen,
                                size: 64,
                                color: ocTheme.textMuted.withValues(alpha: 0.5),
                              ),
                              const SizedBox(height: Spacing.lg),
                              Text(
                                'No projects found',
                                style: TextStyle(
                                  color: ocTheme.text,
                                  fontSize: 18,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: Spacing.sm),
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
      ),
    );
  }

  Future<void> _openProject(BuildContext context, ProjectSummary project) {
    return openProjectForSelectedAgent(
      context: context,
      ref: ref,
      project: project,
    );
  }

  Future<void> _showAddProject() async {
    final project = await showAddProjectSheet(context);
    if (project == null || !mounted) return;
    await _openProject(context, project);
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
          // Logo row with add button on right
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // Broski logo - transparent bg version
              Image.asset(
                'docs/assets/Untitled design (1).png',
                height: 112,
                filterQuality: FilterQuality.high,
              ),
              const Spacer(),
              // Add project button - nudged up 9px to align with logo text
              if (onAddProject != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 9),
                  child: GestureDetector(
                    onTap: onAddProject,
                    child: Container(
                      padding: Insets.cardXs,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surface,
                        borderRadius: Radii.brMd,
                        border: Border.all(
                          color: theme.colorScheme.onSurface.withValues(
                            alpha: 0.15,
                          ),
                        ),
                      ),
                      child: Icon(
                        AppIcons.folderPlus,
                        color: theme.colorScheme.onSurface,
                        size: 24,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: Spacing.md),
          Text(
            'Select a repo to start vibe coding',
            style: TextStyle(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              fontSize: 15,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: Spacing.xl),
          // Connection quality indicator with signal bars
          const LinkStatusIndicator(),
        ],
      ),
    );
  }
}

class _HighlightedProjectCard extends StatelessWidget {
  const _HighlightedProjectCard({
    required this.project,
    required this.highlightColor,
    required this.onTap,
    required this.onLongPress,
  });
  final ProjectSummary project;
  final HighlightColor highlightColor;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final color = highlightColor.forBrightness(
      theme.brightness,
      themePrimary: ocTheme.primary,
    );
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      child: Container(
        padding: Insets.input,
        decoration: BoxDecoration(
          color: highlightColor.backgroundFor(
            theme.brightness,
            themePrimary: ocTheme.primary,
          ),
          borderRadius: Radii.brMd,
          border: Border(
            left: BorderSide(color: color, width: 3),
            top: BorderSide(
              color: highlightColor.borderFor(
                theme.brightness,
                themePrimary: ocTheme.primary,
              ),
            ),
            right: BorderSide(
              color: highlightColor.borderFor(
                theme.brightness,
                themePrimary: ocTheme.primary,
              ),
            ),
            bottom: BorderSide(
              color: highlightColor.borderFor(
                theme.brightness,
                themePrimary: ocTheme.primary,
              ),
            ),
          ),
        ),
        child: Row(
          children: [
            Icon(AppIcons.star, color: color, size: 20),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    project.name,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: Spacing.xxs),
                  Text(
                    '~/${project.path.split('/').last}',
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            Text(
              'Open',
              style: TextStyle(
                color: color,
                fontSize: 14,
                fontWeight: FontWeight.w600,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One project row.
class _ProjectItem extends StatelessWidget {
  const _ProjectItem({
    required this.project,
    required this.onTap,
    this.onLongPress,
  });
  final ProjectSummary project;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Padding(
      padding: Insets.bottomSm,
      child: GestureDetector(
        onTap: onTap,
        onLongPress: onLongPress,
        child: Container(
          padding: Insets.input,
          decoration: BoxDecoration(
            color: ocTheme.backgroundPanel,
            borderRadius: Radii.brMd,
            border: Border.all(
              color: ocTheme.borderSubtle.withValues(alpha: 0.5),
              width: 1,
            ),
          ),
          child: Row(
            children: [
              Icon(AppIcons.gitBranch, color: ocTheme.textMuted, size: 20),
              const SizedBox(width: Spacing.md),
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
