import 'package:broski/models/agent_type.dart';
import 'package:broski/models/claude_code.dart';
import 'package:broski/models/codex.dart';
import 'package:broski/models/project.dart';
import 'package:broski/models/runtime/runtime_session_summary.dart';
import 'package:broski/models/session.dart';
import 'package:broski/providers/agent_type_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/chat_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Fetches subagent/task sessions for the active backend via unified children API.
/// Grouped by parent session.
final subagentTasksProvider =
    FutureProvider.family<List<RuntimeSessionSummary>, String?>((
      ref,
      cwd,
    ) async {
      final bridge = ref.watch(bridgeServiceProvider);
      final backend = ref.watch(agentTypeProvider);

      // Get all sessions (including subagents) via unified API
      List<RuntimeSessionSummary> allSessions;
      try {
        final rawSessions = await bridge.unifiedListSessions(
          backend: backend,
          cwd: cwd,
          roots: false, // Need all sessions to find subagents
        );
        allSessions = rawSessions
            .map((json) => RuntimeSessionSummary.fromJson(json))
            .toList();
      } catch (_) {
        return [];
      }

      // Collect all subagent sessions already in the list
      final subagents = allSessions.where((s) => s.isSubagentSession).toList();

      // For parents that report children but whose children aren't in the list,
      // fetch them on-demand via unified_list_session_children
      final parentsWithChildren = allSessions.where(
        (s) => s.hasChildren && !s.isSubagentSession,
      );
      for (final parent in parentsWithChildren) {
        final alreadyHasKids = subagents.any(
          (s) => s.parentSessionId == parent.id,
        );
        if (!alreadyHasKids) {
          try {
            final children = await bridge.listSessionChildren(
              backend: backend.wireValue,
              sessionId: parent.id,
              cwd: cwd,
            );
            subagents.addAll(children);
          } catch (_) {}
        }
      }

      subagents.sort((a, b) => b.updatedAtMs.compareTo(a.updatedAtMs));
      return subagents;
    });

/// A dedicated view showing all subagent/task sessions for the active backend.
/// Meant to be shown as a tab alongside the main sessions list.
class SubagentTasksView extends ConsumerWidget {
  const SubagentTasksView({super.key, this.cwd});
  final String? cwd;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final tasksAsync = ref.watch(subagentTasksProvider(cwd));
    final backend = ref.watch(agentTypeProvider);

    return tasksAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Text(
          'Failed to load tasks: $e',
          style: TextStyle(color: ocTheme.textMuted),
        ),
      ),
      data: (tasks) {
        if (tasks.isEmpty) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  AppIcons.code,
                  size: 48,
                  color: ocTheme.textMuted.withValues(alpha: 0.4),
                ),
                const SizedBox(height: Spacing.lg),
                Text(
                  'No subagent tasks',
                  style: TextStyle(
                    color: ocTheme.text,
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: Spacing.sm),
                Text(
                  'Subagent and task sessions from ${backend.displayName} will appear here',
                  style: TextStyle(color: ocTheme.textMuted, fontSize: 14),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          );
        }

        // Group by parent, sorted by most recently active group
        final grouped = <String?, List<RuntimeSessionSummary>>{};
        for (final task in tasks) {
          grouped.putIfAbsent(task.parentSessionId, () => []).add(task);
        }
        final sortedKeys = grouped.keys.toList()
          ..sort((a, b) {
            final aMax = grouped[a]!
                .map((t) => t.updatedAtMs)
                .fold<int>(0, (p, v) => v > p ? v : p);
            final bMax = grouped[b]!
                .map((t) => t.updatedAtMs)
                .fold<int>(0, (p, v) => v > p ? v : p);
            return bMax.compareTo(aMax);
          });

        return ListView.builder(
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 100),
          itemCount: sortedKeys.length,
          itemBuilder: (context, index) {
            final parentId = sortedKeys[index];
            final children = grouped[parentId]!;
            return _ParentGroup(parentId: parentId, children: children);
          },
        );
      },
    );
  }
}

class _ParentGroup extends StatelessWidget {
  const _ParentGroup({required this.parentId, required this.children});
  final String? parentId;
  final List<RuntimeSessionSummary> children;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (parentId != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 12, 4, 8),
            child: Row(
              children: [
                Icon(AppIcons.chatBubble, size: 14, color: ocTheme.textMuted),
                const SizedBox(width: 6),
                Text(
                  'Parent: ${parentId!.length > 12 ? '${parentId!.substring(0, 12)}…' : parentId!}',
                  style: TextStyle(
                    color: ocTheme.textMuted,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.3,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 6,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: ocTheme.info.withValues(alpha: 0.12),
                    borderRadius: Radii.brXs,
                  ),
                  child: Text(
                    '${children.length}',
                    style: TextStyle(
                      color: ocTheme.info,
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ...children.map(
          (task) => Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _TaskCard(task: task),
          ),
        ),
      ],
    );
  }
}

class _TaskCard extends ConsumerWidget {
  const _TaskCard({required this.task});
  final RuntimeSessionSummary task;

  String _formatDate(int ms) {
    if (ms == 0) return '';
    final date = DateTime.fromMillisecondsSinceEpoch(ms);
    final now = DateTime.now();
    final diff = now.difference(date);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${date.day}/${date.month}/${date.year}';
  }

  /// Per-backend detail text extracted from backendData.
  String _backendDetail() {
    final data = task.backendData;
    if (data == null) return '';
    switch (task.backend) {
      case AgentType.claudeCode:
        // CC: show message count
        final msgCount = data['messageCount'] as int?;
        if (msgCount != null && msgCount > 0) return '$msgCount messages';
        return '';
      case AgentType.codex:
        // Codex: show agent role
        final role = data['agentRole'] as String?;
        if (role != null && role.isNotEmpty) return role;
        return '';
      case AgentType.opencode:
        return '';
    }
  }

  void _openSession(BuildContext context, WidgetRef ref) {
    final backend = task.backend;
    Widget screen;

    switch (backend) {
      case AgentType.claudeCode:
        // CC subagent: id is agentId, parentSessionId is the parent session
        screen = ChatScreen.claudeCode(
          ccSession: ClaudeCodeSession(
            id: task.id,
            cwd: task.cwd,
            createdAt: task.createdAtMs,
            updatedAt: task.updatedAtMs,
            title: task.title,
            isBackground: true,
            subagentName: task.subagentType,
            parentSessionId: task.parentSessionId,
          ),
          readOnly: true,
        );
      case AgentType.opencode:
        final session = SessionSummary(
          id: task.id,
          title: task.title,
          projectID: '',
          directory: task.cwd,
          parentID: task.parentSessionId ?? '',
          time: SessionTime(
            created: task.createdAtMs,
            updated: task.updatedAtMs,
          ),
        );
        final project = ProjectSummary(
          id: '',
          name:
              task.cwd.split('/').where((p) => p.isNotEmpty).lastOrNull ??
              'Project',
          path: task.cwd,
        );
        screen = ChatScreen(project: project, session: session);
      case AgentType.codex:
        screen = ChatScreen.codex(
          cxThread: CodexThread(
            id: task.id,
            preview: task.title,
            cwd: task.cwd,
            createdAt: task.createdAtMs,
            updatedAt: task.updatedAtMs,
          ),
        );
    }

    Navigator.push(context, MaterialPageRoute(builder: (_) => screen));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final typeLabel = task.subagentType ?? task.sessionKind ?? 'subagent';
    final stats = task.summary;
    final hasStats =
        stats != null && (stats.additions > 0 || stats.deletions > 0);
    final detail = _backendDetail();

    return GestureDetector(
      onTap: () => _openSession(context, ref),
      child: Container(
        decoration: BoxDecoration(
          color: ocTheme.backgroundElement.withValues(alpha: 0.4),
          borderRadius: Radii.brSm,
        ),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            Container(
              width: 2,
              decoration: BoxDecoration(
                color: ocTheme.info.withValues(alpha: 0.4),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(8),
                  bottomLeft: Radius.circular(8),
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 5,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.info.withValues(alpha: 0.12),
                            borderRadius: Radii.brXs,
                          ),
                          child: Text(
                            typeLabel,
                            style: TextStyle(
                              color: ocTheme.info,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            task.title,
                            style: TextStyle(
                              color: ocTheme.text.withValues(alpha: 0.85),
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    if (detail.isNotEmpty) ...[
                      const SizedBox(height: 2),
                      Text(
                        detail,
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 11,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    const SizedBox(height: Spacing.xs),
                    Row(
                      children: [
                        Text(
                          _formatDate(task.updatedAtMs),
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 11,
                          ),
                        ),
                        if (hasStats) ...[
                          Text(
                            ' · ',
                            style: TextStyle(
                              color: ocTheme.textMuted.withValues(alpha: 0.5),
                              fontSize: 11,
                            ),
                          ),
                          if (stats.additions > 0)
                            Text(
                              '+${stats.additions}',
                              style: TextStyle(
                                color: ocTheme.diffAdded,
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                          if (stats.additions > 0 && stats.deletions > 0)
                            const SizedBox(width: 4),
                          if (stats.deletions > 0)
                            Text(
                              '-${stats.deletions}',
                              style: TextStyle(
                                color: ocTheme.diffRemoved,
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                        ],
                        const Spacer(),
                        Icon(
                          _backendIcon(task.backend),
                          size: 12,
                          color: ocTheme.textMuted,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  IconData _backendIcon(AgentType backend) {
    switch (backend) {
      case AgentType.claudeCode:
        return AppIcons.terminal;
      case AgentType.opencode:
        return AppIcons.code;
      case AgentType.codex:
        return AppIcons.smartToy;
    }
  }
}
