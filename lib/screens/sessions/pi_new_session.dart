import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/project.dart';
import '../../providers/pi_provider.dart';
import '../../theme/app_icons.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/sessions/pi_project_tile.dart';

/// Project picker for creating a new Pi session.
/// Shows Pi-only projects: derived from Pi sessions (via bridge pi_list_projects).
/// Extracted from sessions_screen.dart.
class PiNewSessionContent extends ConsumerWidget {
  const PiNewSessionContent({required this.onSelectProject});

  final void Function(String path, String name) onSelectProject;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final piProjectsLiveAsync = ref.watch(piProjectsForSessionsProvider);
    final piSessionProjectsAsync = ref.watch(piFilterProjectsProvider);

    // Merge bridge-discovered Pi projects + session-derived Pi projects (deduped)
    final liveProjects = piProjectsLiveAsync.valueOrNull ?? const [];
    final sessionProjects = piSessionProjectsAsync.valueOrNull ?? const [];
    final isLoading =
        piProjectsLiveAsync.isLoading && piSessionProjectsAsync.isLoading;

    final byPath = <String, ProjectSummary>{};
    for (final p in liveProjects) {
      byPath[p.path] = p;
    }
    for (final p in sessionProjects) {
      byPath.putIfAbsent(p.path, () => p);
    }
    final allProjects = byPath.values.toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

    // Separate: projects that already have Pi sessions vs fresh projects
    final piPaths = sessionProjects.map((p) => p.path).toSet();
    final piActiveProjects = allProjects
        .where((p) => piPaths.contains(p.path))
        .toList();
    final otherProjects = allProjects
        .where((p) => !piPaths.contains(p.path))
        .toList();

    if (isLoading) {
      return const Padding(
        padding: EdgeInsets.all(32),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (allProjects.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(32),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(AppIcons.folderOff, color: ocTheme.textMuted, size: 48),
              SizedBox(height: Spacing.lg),
              Text(
                'No projects found',
                style: TextStyle(color: ocTheme.text, fontSize: 16),
              ),
              SizedBox(height: Spacing.sm),
              Text(
                'Open a project from the Projects tab first.',
                style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    return ListView(
      shrinkWrap: true,
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
      children: [
        // Pi-active projects first
        if (piActiveProjects.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              'PROJECTS WITH PI SESSIONS',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: ocTheme.textMuted,
                letterSpacing: 0.5,
              ),
            ),
          ),
          for (final project in piActiveProjects)
            PiProjectTile(
              project: project,
              hasExistingSessions: true,
              onTap: () => onSelectProject(project.path, project.name),
            ),
          SizedBox(height: Spacing.xl),
        ],
        // Other projects
        if (otherProjects.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              'OTHER PROJECTS',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: ocTheme.textMuted,
                letterSpacing: 0.5,
              ),
            ),
          ),
          for (final project in otherProjects)
            PiProjectTile(
              project: project,
              hasExistingSessions: false,
              onTap: () => onSelectProject(project.path, project.name),
            ),
        ],
      ],
    );
  }
}
