import 'package:broski/models/project.dart';
import 'package:broski/providers/codex_provider.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows a project picker sheet for starting a new Codex thread.
/// Extracted from sessions_screen.dart per modular architecture rules.
void showNewCxThreadSheet(BuildContext context) {
  DetailSheet.show(
    context: context,
    title: 'New Codex Thread',
    initialSize: 0.6,
    maxSize: 0.9,
    child: Consumer(
      builder: (context, ref, _) {
        final projectsAsync = ref.watch(codexProjectsForThreadsProvider);
        return projectsAsync.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(32),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (e, _) => Padding(
            padding: const EdgeInsets.all(32),
            child: Center(
              child: Text('Failed to load projects: ${humanizeError(e)}'),
            ),
          ),
          data: (projects) {
            if (projects.isEmpty) {
              final ocTheme = OpenCodeTheme.of(context);
              return Padding(
                padding: const EdgeInsets.all(32),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        AppIcons.folderOff,
                        color: ocTheme.textMuted,
                        size: 48,
                      ),
                      const SizedBox(height: Spacing.lg),
                      Text(
                        'No projects found',
                        style: TextStyle(color: ocTheme.text, fontSize: 16),
                      ),
                    ],
                  ),
                ),
              );
            }
            final sorted = [...projects]
              ..sort(
                (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
              );
            return ListView.builder(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              itemCount: sorted.length,
              itemBuilder: (context, index) {
                final project = sorted[index];
                final ocTheme = OpenCodeTheme.of(context);
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: InkWell(
                    onTap: () {
                      Navigator.pop(context);
                      _startNewCxThread(context, ref, project);
                    },
                    borderRadius: Radii.brMd,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: ocTheme.backgroundPanel,
                        borderRadius: Radii.brMd,
                        border: Border.all(color: ocTheme.borderSubtle),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 32,
                            height: 32,
                            decoration: BoxDecoration(
                              color: ocTheme.primary.withValues(alpha: 0.12),
                              borderRadius: Radii.brSm,
                            ),
                            child: Icon(
                              AppIcons.folder,
                              size: 16,
                              color: ocTheme.primary,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  project.name,
                                  style: TextStyle(
                                    color: ocTheme.text,
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  project.path,
                                  style: TextStyle(
                                    color: ocTheme.textMuted,
                                    fontSize: 12,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                          Icon(
                            AppIcons.chevronRight,
                            size: 18,
                            color: ocTheme.textMuted,
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            );
          },
        );
      },
    ),
  );
}

void _startNewCxThread(
  BuildContext context,
  WidgetRef ref,
  ProjectSummary project,
) {
  ref.read(selectionProvider.notifier).selectProject(project);
  Navigator.push(
    context,
    MaterialPageRoute(builder: (_) => ChatScreen.codexDraft(cwd: project.path)),
  );
}
