import 'package:broski/providers/pi_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/section_header.dart';
import 'package:broski/widgets/sessions/pi_project_tile.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Project picker for creating a new Pi session.
/// Shows Pi-only projects: derived from Pi sessions (via bridge pi_list_projects).
/// Extracted from sessions_screen.dart.
class PiNewSessionContent extends ConsumerWidget {
  const PiNewSessionContent({super.key, required this.onSelectProject});

  final void Function(String path, String name) onSelectProject;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final piProjectsLiveAsync = ref.watch(piProjectsForSessionsProvider);

    final liveProjects = piProjectsLiveAsync.valueOrNull ?? const [];
    final isLoading = piProjectsLiveAsync.isLoading;

    final allProjects = liveProjects.toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

    // Pi's project list is the one Pi already has sessions in, plus the app's own projects.
    final piPaths = liveProjects.map((p) => p.path).toSet();
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
              const SizedBox(height: Spacing.lg),
              Text(
                'No projects found',
                style: TextStyle(color: ocTheme.text, fontSize: 16),
              ),
              const SizedBox(height: Spacing.sm),
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
            child: SectionHeader(
              title: 'PROJECTS WITH PI SESSIONS',
              theme: ocTheme,
            ),
          ),
          for (final project in piActiveProjects)
            PiProjectTile(
              project: project,
              hasExistingSessions: true,
              onTap: () => onSelectProject(project.path, project.name),
            ),
          const SizedBox(height: Spacing.xl),
        ],
        // Other projects
        if (otherProjects.isNotEmpty) ...[
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: SectionHeader(title: 'OTHER PROJECTS', theme: ocTheme),
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
