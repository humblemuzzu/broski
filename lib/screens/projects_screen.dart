import 'package:broski/models/agent_type.dart';
import 'package:broski/models/highlight_color.dart';
import 'package:broski/models/permission_rule.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/worktree.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/chat_provider.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/highlights_provider.dart';
import 'package:broski/providers/permission_rules_provider.dart';
import 'package:broski/providers/pi_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/providers/tool_settings_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/screens/dialogs/project_context_menu.dart';
import 'package:broski/screens/sheets/add_project_sheet.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/connection_quality_indicator.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class ProjectsScreen extends ConsumerStatefulWidget {
  const ProjectsScreen({super.key});
  @override
  ConsumerState<ProjectsScreen> createState() => _ProjectsScreenState();
}

/// State provider for expanded projects (showing worktrees)
final _expandedProjectsProvider = StateProvider.autoDispose<Set<String>>(
  (ref) => {},
);

/// Cache provider for loaded worktrees per project path
final _projectWorktreesProvider =
    StateProvider.autoDispose<Map<String, List<Worktree>>>((ref) => {});

class _ProjectsScreenState extends ConsumerState<ProjectsScreen> {
  late Future<List<ProjectSummary>> _projectsFuture;
  late AgentType _agentType;
  late final ProviderSubscription<AgentType> _agentTypeSub;
  String? _creatingWorktreeForPath;
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

    // Each agent has its own isolated cache — no cross-contamination.
    Future<List<ProjectSummary>> getCached() => switch (agentType) {
      AgentType.opencode => storage.getCachedProjects(),
      AgentType.codex => storage.getCachedCodexProjects(),
      AgentType.claudeCode => storage.getCachedCCProjects(),
      AgentType.pi => storage.getCachedPiProjects(),
    };

    Future<void> setCache(List<ProjectSummary> projects) => switch (agentType) {
      AgentType.opencode => storage.cacheProjects(projects),
      AgentType.codex => storage.cacheCodexProjects(projects),
      AgentType.claudeCode => storage.cacheCCProjects(projects),
      AgentType.pi => storage.cachePiProjects(projects),
    };

    // Offline mode: return per-agent cached projects
    if (connection.isOfflineMode) {
      return getCached();
    }

    // Try live data first, fallback to per-agent cache on failure
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final projects = switch (agentType) {
        AgentType.claudeCode => await bridge.ccListProjects(),
        AgentType.codex => await bridge.cxListProjects(),
        AgentType.opencode => await bridge.listProjects(),
        AgentType.pi => await ref.read(piBridgeServiceProvider).listProjects(),
      };
      if (projects.isNotEmpty) {
        await setCache(projects);
      }
      return projects;
    } catch (e) {
      final cached = await getCached();
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

  /// Toggle expansion state for a project to show/hide worktrees
  Future<void> _toggleProjectExpansion(ProjectSummary project) async {
    final expanded = ref.read(_expandedProjectsProvider);
    final isExpanded = expanded.contains(project.path);
    if (isExpanded) {
      // Collapse
      ref.read(_expandedProjectsProvider.notifier).state = {...expanded}
        ..remove(project.path);
    } else {
      // Expand and load worktrees if not cached
      ref.read(_expandedProjectsProvider.notifier).state = {
        ...expanded,
        project.path,
      };
      // Load worktrees if not already cached
      final worktreesCache = ref.read(_projectWorktreesProvider);
      if (!worktreesCache.containsKey(project.path)) {
        await _loadWorktreesFor(project);
      }
    }
  }

  /// Load worktrees for a project
  Future<void> _loadWorktreesFor(ProjectSummary project) async {
    final bridge = ref.read(bridgeServiceProvider);
    try {
      final worktrees = await bridge.listWorktrees(projectPath: project.path);
      if (mounted) {
        ref.read(_projectWorktreesProvider.notifier).state = {
          ...ref.read(_projectWorktreesProvider),
          project.path: worktrees,
        };
      }
    } catch (e) {
      // On error, store empty list to prevent repeated attempts
      if (mounted) {
        ref.read(_projectWorktreesProvider.notifier).state = {
          ...ref.read(_projectWorktreesProvider),
          project.path: <Worktree>[],
        };
      }
    }
  }

  /// Open a session in a specific worktree
  Future<void> _openWorktreeSession(
    BuildContext context,
    ProjectSummary project,
    Worktree worktree,
  ) async {
    final bridge = ref.read(bridgeServiceProvider);
    final chat = ref.read(chatSessionProvider.notifier);
    final baseRules = ref.read(permissionRulesProvider).effectiveRuleset;
    final disabledTools = ref.read(toolSettingsProvider).disabledTools;
    final permissionRules = applyDisabledToolsToRuleset(
      baseRules,
      disabledTools,
    );
    try {
      final session = await bridge.createSession(
        projectPath: worktree.directory,
        permission: permissionRules,
      );
      final worktreeProject = ProjectSummary(
        id: project.id,
        name: worktree.displayName,
        path: worktree.directory,
      );
      chat.setSession(session, projectPath: worktree.directory);
      if (!mounted) return;
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) =>
              ChatScreen(project: worktreeProject, session: session),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to create session: ${humanizeError(e)}');
    }
  }

  Future<void> _showCreateWorktreeSheet(ProjectSummary project) async {
    final ocTheme = OpenCodeTheme.of(context);
    final nameController = TextEditingController();
    final cmdController = TextEditingController();
    String? currentBranch;
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final vcs = await bridge.getVcsInfo(projectPath: project.path);
      currentBranch = vcs.branch;
    } catch (_) {
      currentBranch = null;
    }
    if (!mounted) return;
    await DetailSheet.show<void>(
      context: context,
      title: 'New Worktree',
      initialSize: 0.5,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'Creates a new sandbox worktree from the current branch.',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
            ),
            const SizedBox(height: Spacing.md),
            TextField(
              controller: nameController,
              decoration: InputDecoration(
                labelText: 'Name',
                hintText: 'e.g. feature-dark-mode',
                filled: true,
                fillColor: ocTheme.backgroundElement,
                border: OutlineInputBorder(
                  borderRadius: Radii.brMd,
                  borderSide: BorderSide(color: ocTheme.borderSubtle),
                ),
              ),
            ),
            const SizedBox(height: Spacing.md),
            TextField(
              controller: cmdController,
              decoration: InputDecoration(
                labelText: 'Start command (optional)',
                hintText: 'e.g. pnpm install',
                filled: true,
                fillColor: ocTheme.backgroundElement,
                border: OutlineInputBorder(
                  borderRadius: Radii.brMd,
                  borderSide: BorderSide(color: ocTheme.borderSubtle),
                ),
              ),
            ),
            const SizedBox(height: Spacing.md),
            Row(
              children: [
                Icon(AppIcons.callSplit, size: 18, color: ocTheme.textMuted),
                const SizedBox(width: Spacing.sm),
                Text(
                  'Base branch:',
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
                ),
                const SizedBox(width: Spacing.sm),
                Text(
                  currentBranch ?? '(unknown)',
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
            const SizedBox(height: Spacing.xxl),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () async {
                  final name = nameController.text.trim();
                  final cmd = cmdController.text.trim();
                  Navigator.pop(context);
                  await _createWorktree(
                    project,
                    name: name.isEmpty ? null : name,
                    startCommand: cmd.isEmpty ? null : cmd,
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: ocTheme.primary,
                  foregroundColor: ocTheme.background,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
                ),
                child: const Text('Create'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _createWorktree(
    ProjectSummary project, {
    required String? name,
    required String? startCommand,
  }) async {
    setState(() => _creatingWorktreeForPath = project.path);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final created = await bridge.createWorktree(
        name: name,
        startCommand: startCommand,
        projectPath: project.path,
      );
      if (created != null && mounted) {
        final current = ref.read(_projectWorktreesProvider)[project.path] ?? [];
        final updated = [...current];
        if (!updated.contains(created)) updated.add(created);
        ref.read(_projectWorktreesProvider.notifier).state = {
          ...ref.read(_projectWorktreesProvider),
          project.path: updated,
        };
        ref.read(_expandedProjectsProvider.notifier).state = {
          ...ref.read(_expandedProjectsProvider),
          project.path,
        };
      }
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to create worktree: ${humanizeError(e)}');
    } finally {
      if (mounted) setState(() => _creatingWorktreeForPath = null);
    }
  }

  Future<void> _deleteWorktree(
    ProjectSummary project,
    Worktree worktree,
  ) async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.deleteWorktree(
        worktree.directory,
        projectPath: project.path,
      );
      if (!mounted) return;
      if (!ok) {
        showError(context, 'Failed to delete worktree');
        return;
      }
      final current = ref.read(_projectWorktreesProvider)[project.path] ?? [];
      ref.read(_projectWorktreesProvider.notifier).state = {
        ...ref.read(_projectWorktreesProvider),
        project.path: current
            .where((w) => w.directory != worktree.directory)
            .toList(),
      };
      showSuccess(context, 'Worktree deleted');
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to delete worktree: ${humanizeError(e)}');
    }
  }

  Future<void> _resetWorktree(ProjectSummary project, Worktree worktree) async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.resetWorktree(
        worktree.directory,
        projectPath: project.path,
      );
      if (!mounted) return;
      if (ok) {
        showSuccess(context, 'Worktree reset');
      } else {
        showError(context, 'Failed to reset worktree');
      }
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to reset worktree: ${humanizeError(e)}');
    }
  }

  Future<void> _showWorktreeOptions(
    ProjectSummary project,
    Worktree worktree,
  ) async {
    final ocTheme = OpenCodeTheme.of(context);
    if (!mounted) return;
    await DetailSheet.show<void>(
      context: context,
      title: worktree.displayName,
      initialSize: 0.35,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            leading: Icon(AppIcons.openExternal, color: ocTheme.textMuted),
            title: Text('Open', style: TextStyle(color: ocTheme.text)),
            onTap: () {
              Navigator.pop(context);
              _openWorktreeSession(context, project, worktree);
            },
          ),
          ListTile(
            leading: Icon(AppIcons.copy, color: ocTheme.textMuted),
            title: Text('Copy path', style: TextStyle(color: ocTheme.text)),
            onTap: () async {
              await Clipboard.setData(ClipboardData(text: worktree.directory));
              if (!mounted) return;
              Navigator.pop(context);
              showSuccess(context, 'Path copied');
            },
          ),
          ListTile(
            leading: Icon(AppIcons.refresh, color: ocTheme.textMuted),
            title: Text('Reset', style: TextStyle(color: ocTheme.text)),
            onTap: () async {
              Navigator.pop(context);
              await _resetWorktree(project, worktree);
            },
          ),
          ListTile(
            leading: Icon(AppIcons.delete, color: ocTheme.error),
            title: Text('Delete', style: TextStyle(color: ocTheme.error)),
            onTap: () async {
              Navigator.pop(context);
              await _deleteWorktree(project, worktree);
            },
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final agentType = ref.watch(agentTypeProvider);
    final connection = ref.watch(connectionProvider);
    final highlights = ref.watch(highlightsProvider);
    final expandedProjects = ref.watch(_expandedProjectsProvider);
    final projectWorktrees = ref.watch(_projectWorktreesProvider);
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
                    // OpenCode warning if not running
                    if (agentType == AgentType.opencode &&
                        !connection.opencodeRunning)
                      SliverToBoxAdapter(
                        child: _OpenCodeWarning(
                          onStart: () => _startOpenCode(context),
                          onRefresh: _refresh,
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
                          delegate: SliverChildBuilderDelegate((
                            context,
                            index,
                          ) {
                            final project = regularProjects[index];
                            final isExpanded = expandedProjects.contains(
                              project.path,
                            );
                            final worktrees = projectWorktrees[project.path];
                            final isLoading = isExpanded && worktrees == null;
                            return _ExpandableProjectItem(
                              project: project,
                              isExpanded: isExpanded,
                              isLoading: isLoading,
                              worktrees: worktrees ?? [],
                              onTap: () => _openProject(context, project),
                              onLongPress: () =>
                                  _showProjectContextMenu(project),
                              onToggleExpand: agentType == AgentType.opencode
                                  ? () => _toggleProjectExpansion(project)
                                  : null,
                              onWorktreeTap: (worktree) => _openWorktreeSession(
                                context,
                                project,
                                worktree,
                              ),
                              onWorktreeLongPress: (worktree) =>
                                  _showWorktreeOptions(project, worktree),
                              onWorktreeDelete: (worktree) =>
                                  _deleteWorktree(project, worktree),
                              onCreateWorktree:
                                  agentType == AgentType.opencode &&
                                      !connection.isOfflineMode
                                  ? () => _showCreateWorktreeSheet(project)
                                  : null,
                              isCreatingWorktree:
                                  _creatingWorktreeForPath == project.path,
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

  Future<void> _openProject(
    BuildContext context,
    ProjectSummary project,
  ) async {
    final currentAgentType = ref.read(agentTypeProvider);
    if (currentAgentType == AgentType.claudeCode) {
      await _openClaudeProject(context, project);
      return;
    }
    if (currentAgentType == AgentType.codex) {
      await _openCodexProject(context, project);
      return;
    }
    if (currentAgentType == AgentType.pi) {
      await _openPiProject(context, project);
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
        showInfo(context, 'No cached sessions for this project');
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
    final baseRules = ref.read(permissionRulesProvider).effectiveRuleset;
    final disabledTools = ref.read(toolSettingsProvider).disabledTools;
    final permissionRules = applyDisabledToolsToRuleset(
      baseRules,
      disabledTools,
    );
    final session = await bridge.createSession(
      projectPath: project.path,
      permission: permissionRules,
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
        builder: (_) =>
            ChatScreen.claudeCodeDraft(cwd: project.path, title: project.name),
      ),
    );
  }

  Future<void> _openCodexProject(
    BuildContext context,
    ProjectSummary project,
  ) async {
    ref.read(selectionProvider.notifier).selectProject(project);
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            ChatScreen.codexDraft(cwd: project.path, title: project.name),
      ),
    );
  }

  Future<void> _openPiProject(
    BuildContext context,
    ProjectSummary project,
  ) async {
    ref.read(selectionProvider.notifier).selectProject(project);
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) =>
            ChatScreen.piDraft(cwd: project.path, title: project.name),
      ),
    );
  }

  Future<void> _startOpenCode(BuildContext context) async {
    final bridge = ref.read(bridgeServiceProvider);
    showInfo(context, 'Restarting OpenCode...');
    final ok = await bridge.restartOpenCode();
    if (!mounted) return;
    if (ok) {
      showSuccess(context, 'OpenCode restarted');
    } else {
      showError(context, 'Failed to restart OpenCode');
    }
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
      padding: Insets.card,
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: Radii.brLg,
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
                padding: Insets.cardXs,
                decoration: BoxDecoration(
                  color: ocTheme.error.withValues(alpha: 0.1),
                  borderRadius: Radii.brSm,
                ),
                child: Icon(AppIcons.warning, color: ocTheme.error, size: 20),
              ),
              const SizedBox(width: Spacing.md),
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
          const SizedBox(height: Spacing.md),
          Text(
            'Start OpenCode on your Mac or run `opencode serve` in terminal.',
            style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
          ),
          const SizedBox(height: Spacing.lg),
          Row(
            children: [
              Expanded(
                child: ElevatedButton(
                  onPressed: onStart,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: ocTheme.primary,
                    foregroundColor: ocTheme.selectedListItemText,
                    padding: Insets.cardV,
                    shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
                  ),
                  child: const Text(
                    'Start OpenCode',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              ),
              const SizedBox(width: Spacing.md),
              OutlinedButton(
                onPressed: onRefresh,
                style: OutlinedButton.styleFrom(
                  foregroundColor: ocTheme.text,
                  side: BorderSide(color: ocTheme.textMuted),
                  padding: const EdgeInsets.symmetric(
                    vertical: 12,
                    horizontal: 20,
                  ),
                  shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
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

// Highlighted project card with accent border
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

/// Expandable project item showing worktrees when expanded
class _ExpandableProjectItem extends StatelessWidget {
  const _ExpandableProjectItem({
    required this.project,
    required this.isExpanded,
    required this.isLoading,
    required this.worktrees,
    required this.onTap,
    this.onLongPress,
    this.onToggleExpand,
    this.onWorktreeTap,
    this.onWorktreeLongPress,
    this.onWorktreeDelete,
    this.onCreateWorktree,
    this.isCreatingWorktree = false,
  });
  final ProjectSummary project;
  final bool isExpanded;
  final bool isLoading;
  final List<Worktree> worktrees;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  final VoidCallback? onToggleExpand;
  final void Function(Worktree)? onWorktreeTap;
  final void Function(Worktree)? onWorktreeLongPress;
  final void Function(Worktree)? onWorktreeDelete;
  final VoidCallback? onCreateWorktree;
  final bool isCreatingWorktree;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final hasWorktrees = worktrees.isNotEmpty;
    final showExpander = onToggleExpand != null;
    return Padding(
      padding: Insets.bottomSm,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Main project row
          GestureDetector(
            onTap: onTap,
            onLongPress: onLongPress,
            child: Container(
              padding: Insets.input,
              decoration: BoxDecoration(
                color: ocTheme.backgroundPanel,
                borderRadius: isExpanded && hasWorktrees
                    ? Radii.sheetTop
                    : Radii.brMd,
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
                  // Expand/collapse button (only for OpenCode)
                  if (showExpander) ...[
                    if (onCreateWorktree != null)
                      Padding(
                        padding: const EdgeInsets.only(right: 4),
                        child: IconButton(
                          icon: isCreatingWorktree
                              ? SizedBox(
                                  width: 18,
                                  height: 18,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: ocTheme.textMuted,
                                  ),
                                )
                              : Icon(
                                  AppIcons.moreVertical,
                                  color: ocTheme.textMuted,
                                  size: 20,
                                ),
                          onPressed: isCreatingWorktree
                              ? null
                              : onCreateWorktree,
                          tooltip: 'New worktree',
                        ),
                      ),
                    GestureDetector(
                      onTap: onToggleExpand,
                      behavior: HitTestBehavior.opaque,
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        child: isLoading
                            ? SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: ocTheme.textMuted,
                                ),
                              )
                            : Icon(
                                isExpanded
                                    ? AppIcons.expandLess
                                    : AppIcons.expandMore,
                                color: ocTheme.textMuted,
                                size: 20,
                              ),
                      ),
                    ),
                    const SizedBox(width: Spacing.xs),
                  ],
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
          // Worktrees (if expanded)
          if (isExpanded && hasWorktrees)
            Container(
              decoration: BoxDecoration(
                color: ocTheme.backgroundPanel.withValues(alpha: 0.6),
                borderRadius: const BorderRadius.vertical(
                  bottom: Radius.circular(12),
                ),
                border: Border(
                  left: BorderSide(
                    color: ocTheme.borderSubtle.withValues(alpha: 0.5),
                    width: 1,
                  ),
                  right: BorderSide(
                    color: ocTheme.borderSubtle.withValues(alpha: 0.5),
                    width: 1,
                  ),
                  bottom: BorderSide(
                    color: ocTheme.borderSubtle.withValues(alpha: 0.5),
                    width: 1,
                  ),
                ),
              ),
              child: Column(
                children: worktrees.map((worktree) {
                  final child = _WorktreeListItem(
                    worktree: worktree,
                    onTap: () => onWorktreeTap?.call(worktree),
                    onLongPress: () => onWorktreeLongPress?.call(worktree),
                  );
                  if (onWorktreeDelete == null) return child;
                  return Dismissible(
                    key: ValueKey(worktree.directory),
                    direction: DismissDirection.endToStart,
                    confirmDismiss: (_) async {
                      return await showDialog<bool>(
                            context: context,
                            builder: (ctx) => AlertDialog(
                              title: const Text('Delete worktree?'),
                              content: Text(
                                'Delete "${worktree.displayName}"? This removes the worktree directory.',
                              ),
                              actions: [
                                TextButton(
                                  onPressed: () => Navigator.pop(ctx, false),
                                  child: const Text('Cancel'),
                                ),
                                TextButton(
                                  onPressed: () => Navigator.pop(ctx, true),
                                  child: Text(
                                    'Delete',
                                    style: TextStyle(color: ocTheme.error),
                                  ),
                                ),
                              ],
                            ),
                          ) ??
                          false;
                    },
                    onDismissed: (_) => onWorktreeDelete?.call(worktree),
                    background: Container(
                      alignment: Alignment.centerRight,
                      padding: const EdgeInsets.only(right: 20),
                      color: ocTheme.error.withValues(alpha: 0.2),
                      child: Icon(AppIcons.delete, color: ocTheme.error),
                    ),
                    child: child,
                  );
                }).toList(),
              ),
            ),
        ],
      ),
    );
  }
}

/// Worktree list item (shown under expanded project)
class _WorktreeListItem extends StatelessWidget {
  const _WorktreeListItem({
    required this.worktree,
    required this.onTap,
    this.onLongPress,
  });
  final Worktree worktree;
  final VoidCallback onTap;
  final VoidCallback? onLongPress;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      onLongPress: onLongPress,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: Insets.section,
        child: Row(
          children: [
            const SizedBox(width: Spacing.sm), // Indent
            Icon(
              AppIcons.altRoute,
              color: ocTheme.primary.withValues(alpha: 0.7),
              size: 16,
            ),
            const SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    worktree.displayName,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (worktree.branch.isNotEmpty)
                    Text(
                      worktree.branch,
                      style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                ],
              ),
            ),
            Icon(AppIcons.chevronRight, color: ocTheme.textMuted, size: 18),
          ],
        ),
      ),
    );
  }
}
