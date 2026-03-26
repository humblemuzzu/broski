import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/project.dart';
import '../../models/worktree.dart';
import '../../providers/service_providers.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

/// New session content with project & worktree selection.
/// Extracted from sessions_screen.dart.
class NewSessionContent extends ConsumerStatefulWidget {
  const NewSessionContent({
    required this.projects,
    required this.onCreateSession,
  });
  final List<ProjectSummary> projects;
  final Future<void> Function(ProjectSummary project, Worktree? worktree)
  onCreateSession;
  @override
  ConsumerState<NewSessionContent> createState() => NewSessionContentState();
}

class NewSessionContentState extends ConsumerState<NewSessionContent> {
  ProjectSummary? _selectedProject;
  Worktree? _selectedWorktree;
  List<Worktree>? _worktrees;
  bool _loadingWorktrees = false;
  bool _creating = false;
  @override
  void initState() {
    super.initState();
    // Auto-select first project if only one
    if (widget.projects.length == 1) {
      _selectedProject = widget.projects.first;
      _loadWorktrees(_selectedProject!);
    }
  }

  Future<void> _loadWorktrees(ProjectSummary project) async {
    setState(() {
      _loadingWorktrees = true;
      _worktrees = null;
      _selectedWorktree = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final worktrees = await bridge.listWorktrees(projectPath: project.path);
      if (mounted) {
        setState(() {
          _worktrees = worktrees;
          _loadingWorktrees = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _worktrees = [];
          _loadingWorktrees = false;
        });
      }
    }
  }

  void _selectProject(ProjectSummary project) {
    setState(() {
      _selectedProject = project;
      _selectedWorktree = null;
    });
    _loadWorktrees(project);
  }

  Future<void> _createSession() async {
    if (_selectedProject == null || _creating) return;
    setState(() => _creating = true);
    try {
      await widget.onCreateSession(_selectedProject!, _selectedWorktree);
    } finally {
      if (mounted) {
        setState(() => _creating = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    if (widget.projects.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(AppIcons.folderOff, color: ocTheme.textMuted, size: 48),
            SizedBox(height: Spacing.lg),
            Text(
              'No projects found',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 16),
            ),
          ],
        ),
      );
    }
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Project selection
              Text(
                'Select Project',
                style: TextStyle(
                  color: ocTheme.textMuted,
                  fontSize: 12,
                  fontWeight: FontWeight.w500,
                ),
              ),
              SizedBox(height: Spacing.sm),
              ...widget.projects.map((project) {
                final isSelected = _selectedProject?.id == project.id;
                return ProjectSelectionTile(
                  project: project,
                  isSelected: isSelected,
                  onTap: () => _selectProject(project),
                );
              }),
              // Worktrees section (if project selected)
              if (_selectedProject != null) ...[
                SizedBox(height: Spacing.xl),
                Text(
                  'Select Worktree (Optional)',
                  style: TextStyle(
                    color: ocTheme.textMuted,
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                SizedBox(height: Spacing.sm),
                if (_loadingWorktrees)
                  const Center(
                    child: Padding(
                      padding: Insets.screenAll,
                      child: CircularProgressIndicator.adaptive(),
                    ),
                  )
                else if (_worktrees == null || _worktrees!.isEmpty)
                  Container(
                    padding: Insets.card,
                    decoration: BoxDecoration(
                      color: ocTheme.background,
                      borderRadius: Radii.brMd,
                      border: Border.all(color: ocTheme.border),
                    ),
                    child: Row(
                      children: [
                        Icon(AppIcons.info, color: ocTheme.textMuted, size: 20),
                        SizedBox(width: Spacing.md),
                        Expanded(
                          child: Text(
                            'No worktrees found. Session will use main project.',
                            style: TextStyle(
                              color: ocTheme.textMuted,
                              fontSize: 14,
                            ),
                          ),
                        ),
                      ],
                    ),
                  )
                else ...[
                  // Main project option
                  WorktreeSelectionTile(
                    name: 'Main Project',
                    path: _selectedProject!.path,
                    isMain: true,
                    isSelected: _selectedWorktree == null,
                    onTap: () => setState(() => _selectedWorktree = null),
                  ),
                  // Worktrees
                  ..._worktrees!.map((worktree) {
                    final isSelected =
                        _selectedWorktree?.directory == worktree.directory;
                    return WorktreeSelectionTile(
                      name: worktree.displayName,
                      path: worktree.directory,
                      isMain: false,
                      isSelected: isSelected,
                      onTap: () => setState(() => _selectedWorktree = worktree),
                    );
                  }),
                ],
              ],
            ],
          ),
        ),
        // Create button
        Padding(
          padding: Insets.card,
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _selectedProject == null || _creating
                  ? null
                  : _createSession,
              style: ElevatedButton.styleFrom(
                backgroundColor: theme.colorScheme.primary,
                foregroundColor: theme.colorScheme.onPrimary,
                disabledBackgroundColor: ocTheme.border,
                padding: Insets.screenV,
                shape: RoundedRectangleBorder(borderRadius: Radii.brMd),
              ),
              child: _creating
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator.adaptive(strokeWidth: 2),
                    )
                  : const Text(
                      'Create Session',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
            ),
          ),
        ),
      ],
    );
  }
}

class ProjectSelectionTile extends StatelessWidget {
  const ProjectSelectionTile({
    required this.project,
    required this.isSelected,
    required this.onTap,
  });
  final ProjectSummary project;
  final bool isSelected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: Insets.bottomSm,
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: isSelected
              ? ocTheme.primary.withValues(alpha: 0.1)
              : ocTheme.background,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isSelected ? ocTheme.primary : ocTheme.border,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Container(
              padding: Insets.cardXs,
              decoration: BoxDecoration(
                color: isSelected
                    ? ocTheme.primary.withValues(alpha: 0.2)
                    : ocTheme.border.withValues(alpha: 0.3),
                borderRadius: Radii.brSm,
              ),
              child: Icon(
                AppIcons.folder,
                color: isSelected ? ocTheme.primary : ocTheme.textMuted,
                size: 20,
              ),
            ),
            SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    project.name,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  SizedBox(height: Spacing.xxs),
                  Text(
                    project.path,
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(AppIcons.checkCircle, color: ocTheme.primary, size: 22),
          ],
        ),
      ),
    );
  }
}

class WorktreeSelectionTile extends StatelessWidget {
  const WorktreeSelectionTile({
    required this.name,
    required this.path,
    required this.isMain,
    required this.isSelected,
    required this.onTap,
  });
  final String name;
  final String path;
  final bool isMain;
  final bool isSelected;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: Insets.bottomSm,
        padding: Insets.cardSm,
        decoration: BoxDecoration(
          color: isSelected
              ? ocTheme.primary.withValues(alpha: 0.1)
              : ocTheme.background,
          borderRadius: Radii.brMd,
          border: Border.all(
            color: isSelected ? ocTheme.primary : ocTheme.border,
            width: isSelected ? 2 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              isMain ? AppIcons.home : AppIcons.gitBranch,
              color: isSelected ? ocTheme.primary : ocTheme.textMuted,
              size: 20,
            ),
            SizedBox(width: Spacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  Text(
                    path,
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            if (isSelected)
              Icon(AppIcons.checkCircle, color: ocTheme.primary, size: 20),
          ],
        ),
      ),
    );
  }
}
