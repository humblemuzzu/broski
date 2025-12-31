import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/agent_type.dart';
import '../models/artifact.dart';
import '../models/project.dart';
import '../providers/artifacts_provider.dart';
import '../providers/agent_type_provider.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import 'artifact_detail_screen.dart';
import 'chat_screen.dart';
import 'artifacts_settings_screen.dart';

class ArtifactsScreen extends ConsumerStatefulWidget {
  const ArtifactsScreen({super.key});

  @override
  ConsumerState<ArtifactsScreen> createState() => _ArtifactsScreenState();
}

class _ArtifactsScreenState extends ConsumerState<ArtifactsScreen> {
  final _controller = TextEditingController();
  bool _askingAi = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() {
      final selection = ref.read(selectionProvider);
      final projectPath = selection.project?.path;
      if (projectPath != null && projectPath.isNotEmpty) {
        ref.read(artifactsProvider.notifier).setProjectPath(projectPath);
      }
      ref.read(artifactsProvider.notifier).refresh();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final state = ref.watch(artifactsProvider);

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.background,
        foregroundColor: ocTheme.text,
        elevation: 0,
        title: const Text('Artifacts'),
        actions: [
          IconButton(
            tooltip: 'Settings',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const ArtifactsSettingsScreen()),
            ),
            icon: const Icon(Icons.settings_rounded),
          ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: () => ref.read(artifactsProvider.notifier).refresh(),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: Column(
              children: [
                _SearchField(
                  controller: _controller,
                  onChanged: (q) => ref.read(artifactsProvider.notifier).setQuery(q),
                  onClear: () {
                    _controller.clear();
                    ref.read(artifactsProvider.notifier).setQuery('');
                  },
                ),
                const SizedBox(height: 10),
                _FiltersRow(
                  backend: state.filters.backend,
                  projectPath: state.filters.projectPath,
                  starredOnly: state.filters.starred,
                  isSearching: state.isSearching,
                  onSelectBackend: (backend) => ref.read(artifactsProvider.notifier).setBackend(backend),
                  onSelectProject: () => _pickProject(context),
                  onToggleStarred: () => ref
                      .read(artifactsProvider.notifier)
                      .setStarredOnly(state.filters.starred == true ? null : true),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: _askingAi ? null : () => _askAiFromResults(),
                    icon: _askingAi
                        ? SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: ocTheme.text,
                            ),
                          )
                        : const Icon(Icons.auto_awesome_rounded),
                    label: Text(_askingAi ? 'Preparing…' : 'Ask AI about results'),
                  ),
                ),
              ],
            ),
          ),
          Expanded(
            child: state.isSearching && state.results.isEmpty
                ? Center(
                    child: CircularProgressIndicator(color: ocTheme.primary),
                  )
                : state.error != null
                ? _ErrorState(
                    message: state.error!,
                    onRetry: () => ref.read(artifactsProvider.notifier).refresh(),
                  )
                : state.results.isEmpty
                ? _EmptyState(
                    hasFilter: state.query.trim().isNotEmpty ||
                        state.filters.backend != null ||
                        state.filters.projectPath != null ||
                        state.filters.starred == true,
                  )
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                    itemCount: state.results.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 10),
                    itemBuilder: (context, index) {
                      final item = state.results[index];
                      return _ArtifactCard(
                        item: item,
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => ArtifactDetailScreen(artifactId: item.id),
                          ),
                        ),
                        onStar: () => ref.read(artifactsProvider.notifier).toggleStar(item),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  Future<void> _pickProject(BuildContext context) async {
    final selection = ref.read(selectionProvider);
    final current = ref.read(artifactsProvider).filters.projectPath;

    final chosen = await showModalBottomSheet<String?>(
      context: context,
      backgroundColor: OpenCodeTheme.of(context).backgroundPanel,
      showDragHandle: true,
      builder: (context) {
        final ocTheme = OpenCodeTheme.of(context);
        final hasCurrentProject =
            selection.project?.path != null && selection.project!.path.isNotEmpty;
        return ListView(
          shrinkWrap: true,
          children: [
            ListTile(
              title: const Text('All projects'),
              trailing: current == null ? const Icon(Icons.check_rounded) : null,
              onTap: () => Navigator.pop(context, null),
            ),
            if (selection.project?.path != null)
              ListTile(
                title: Text(selection.project!.name.isNotEmpty
                    ? selection.project!.name
                    : selection.project!.path.split('/').last),
                subtitle: Text(selection.project!.path),
                trailing: current == selection.project!.path
                    ? const Icon(Icons.check_rounded)
                    : null,
                onTap: () => Navigator.pop(context, selection.project!.path),
              ),
            if (!hasCurrentProject)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                child: Text(
                  'Select a project in Projects/Sessions to filter by it.',
                  style: TextStyle(color: ocTheme.textMuted),
                ),
              ),
          ],
        );
      },
    );

    if (!context.mounted) return;
    final ocTheme = OpenCodeTheme.of(context);
    ref.read(artifactsProvider.notifier).setProjectPath(chosen);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          chosen == null ? 'Showing artifacts from all projects' : 'Filtered to current project',
        ),
        behavior: SnackBarBehavior.floating,
        backgroundColor: ocTheme.backgroundPanel,
        duration: const Duration(seconds: 2),
      ),
    );
  }

  Future<void> _askAiFromResults() async {
    final ocTheme = OpenCodeTheme.of(context);
    final state = ref.read(artifactsProvider);
    if (state.results.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('No results to ask about'),
          behavior: SnackBarBehavior.floating,
          backgroundColor: ocTheme.backgroundPanel,
        ),
      );
      return;
    }

    final inferredProjectPath = state.filters.projectPath ?? _inferSingleProjectPath(state.results);
    if (inferredProjectPath == null || inferredProjectPath.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('Pick a project filter first'),
          behavior: SnackBarBehavior.floating,
          backgroundColor: ocTheme.backgroundPanel,
        ),
      );
      return;
    }

    final question = await _promptForQuestion(prefill: state.query.trim());
    if (!mounted) return;
    if (question == null || question.trim().isEmpty) return;

    setState(() => _askingAi = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final top = state.results.take(5).toList();

      final details = <Artifact>[];
      for (final summary in top) {
        final a = await bridge.getArtifact(summary.id);
        if (a != null) details.add(a);
      }

      final prompt = _buildAskAiPrompt(
        question: question.trim(),
        artifacts: details,
      );

      final agent = ref.read(agentTypeProvider);
      if (agent == AgentType.claudeCode) {
        if (!mounted) return;
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => ChatScreen.claudeCodeDraft(
              cwd: inferredProjectPath,
              title: 'Ask AI (Artifacts)',
              initialPrompt: prompt,
            ),
          ),
        );
        return;
      }

      final selection = ref.read(selectionProvider);
      final project = (selection.project != null &&
              selection.project!.path == inferredProjectPath)
          ? selection.project!
          : ProjectSummary(
              id: inferredProjectPath,
              name: inferredProjectPath.split('/').last,
              path: inferredProjectPath,
            );

      final session = await bridge.createSession(
        projectPath: inferredProjectPath,
        title: 'Ask AI: Artifacts',
      );

      if (!mounted) return;
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ChatScreen(
            project: project,
            session: session,
            initialPrompt: prompt,
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _askingAi = false);
    }
  }

  String? _inferSingleProjectPath(List<ArtifactSummary> items) {
    final unique = <String>{};
    for (final item in items.take(25)) {
      final p = item.projectPath.trim();
      if (p.isNotEmpty) unique.add(p);
      if (unique.length > 1) return null;
    }
    return unique.length == 1 ? unique.first : null;
  }

  Future<String?> _promptForQuestion({required String prefill}) async {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController(text: prefill);
    return await showDialog<String?>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: ocTheme.backgroundPanel,
        title: Text(
          'Ask AI',
          style: TextStyle(color: ocTheme.text, fontWeight: FontWeight.w700),
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          maxLines: 4,
          style: TextStyle(color: ocTheme.text),
          decoration: InputDecoration(
            hintText: 'What do you want to know?',
            hintStyle: TextStyle(color: ocTheme.textMuted),
            filled: true,
            fillColor: ocTheme.backgroundElement,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: ocTheme.borderSubtle),
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, null),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Ask'),
          ),
        ],
      ),
    );
  }

  String _buildAskAiPrompt({
    required String question,
    required List<Artifact> artifacts,
  }) {
    final sb = StringBuffer();
    sb.writeln('You are helping me understand my codebase.');
    sb.writeln('Answer the question using ONLY the context below.');
    sb.writeln('Do not write or edit files. Do not run tools.');
    sb.writeln('When you reference something, cite the source file path.');
    sb.writeln('');
    sb.writeln('Question: $question');
    sb.writeln('');
    sb.writeln('Context (AI-created artifacts):');
    sb.writeln('');

    int i = 0;
    for (final a in artifacts) {
      i++;
      sb.writeln('[$i] ${a.filePath}');
      if ((a.summary ?? '').trim().isNotEmpty) {
        sb.writeln('Summary: ${a.summary!.trim()}');
      }
      final diff = (a.unifiedDiff ?? '').trim();
      final content = (a.contentAfter ?? '').trim();

      if (diff.isNotEmpty) {
        sb.writeln('Diff (truncated):');
        sb.writeln(_truncateBlock(diff, 6000));
      } else if (content.isNotEmpty) {
        sb.writeln('File content (truncated):');
        sb.writeln(_truncateBlock(content, 6000));
      }
      sb.writeln('');
    }

    sb.writeln('Answer:');
    return sb.toString();
  }

  String _truncateBlock(String text, int maxChars) {
    final t = text.trim();
    if (t.length <= maxChars) return t;
    return '${t.substring(0, maxChars)}\n…(truncated)…';
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return ValueListenableBuilder<TextEditingValue>(
      valueListenable: controller,
      builder: (context, value, _) {
        final showClear = value.text.trim().isNotEmpty;
        return TextField(
          controller: controller,
          onChanged: onChanged,
          style: TextStyle(color: ocTheme.text),
          decoration: InputDecoration(
            hintText: 'Search artifacts…',
            hintStyle: TextStyle(color: ocTheme.textMuted),
            filled: true,
            fillColor: ocTheme.backgroundPanel,
            prefixIcon: Icon(Icons.search_rounded, color: ocTheme.textMuted),
            suffixIcon: !showClear
                ? null
                : IconButton(
                    onPressed: onClear,
                    icon: Icon(Icons.close_rounded, color: ocTheme.textMuted),
                  ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: ocTheme.borderSubtle),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(color: ocTheme.borderSubtle),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: BorderSide(
                color: ocTheme.primary.withValues(alpha: 0.6),
              ),
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 12,
            ),
          ),
        );
      },
    );
  }
}

class _FiltersRow extends StatelessWidget {
  const _FiltersRow({
    required this.backend,
    required this.projectPath,
    required this.starredOnly,
    required this.isSearching,
    required this.onSelectBackend,
    required this.onSelectProject,
    required this.onToggleStarred,
  });

  final String? backend;
  final String? projectPath;
  final bool? starredOnly;
  final bool isSearching;
  final ValueChanged<String?> onSelectBackend;
  final VoidCallback onSelectProject;
  final VoidCallback onToggleStarred;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    String backendLabel;
    if (backend == 'opencode') {
      backendLabel = 'OpenCode';
    } else if (backend == 'claude-code') {
      backendLabel = 'Claude Code';
    } else {
      backendLabel = 'All backends';
    }

    final projectLabel = projectPath == null
        ? 'All projects'
        : projectPath!.split('/').last;

    return Row(
      children: [
        _ChipButton(
          label: backendLabel,
          icon: Icons.smart_toy_rounded,
          onTap: () async {
            final selected = await showMenu<String?>(
              context: context,
              position: const RelativeRect.fromLTRB(16, 160, 16, 0),
              color: ocTheme.backgroundPanel,
              items: const [
                PopupMenuItem(value: null, child: Text('All backends')),
                PopupMenuItem(value: 'opencode', child: Text('OpenCode')),
                PopupMenuItem(value: 'claude-code', child: Text('Claude Code')),
              ],
            );
            onSelectBackend(selected);
          },
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _ChipButton(
            label: projectLabel,
            icon: Icons.folder_rounded,
            onTap: onSelectProject,
          ),
        ),
        const SizedBox(width: 10),
        _ChipIconButton(
          icon: starredOnly == true ? Icons.star_rounded : Icons.star_border_rounded,
          color: starredOnly == true ? ocTheme.warning : ocTheme.textMuted,
          onTap: onToggleStarred,
          tooltip: 'Starred only',
        ),
        if (isSearching) ...[
          const SizedBox(width: 10),
          SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: ocTheme.primary,
            ),
          ),
        ],
      ],
    );
  }
}

class _ChipButton extends StatelessWidget {
  const _ChipButton({required this.label, required this.icon, required this.onTap});

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: ocTheme.textMuted),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                label,
                style: TextStyle(color: ocTheme.text, fontSize: 13, fontWeight: FontWeight.w600),
                overflow: TextOverflow.ellipsis,
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

class _ChipIconButton extends StatelessWidget {
  const _ChipIconButton({
    required this.icon,
    required this.color,
    required this.onTap,
    required this.tooltip,
  });

  final IconData icon;
  final Color color;
  final VoidCallback onTap;
  final String tooltip;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(999),
        child: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: ocTheme.backgroundPanel,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: ocTheme.borderSubtle),
          ),
          child: Icon(icon, size: 18, color: color),
        ),
      ),
    );
  }
}

class _ArtifactCard extends ConsumerWidget {
  const _ArtifactCard({
    required this.item,
    required this.onTap,
    required this.onStar,
  });

  final ArtifactSummary item;
  final VoidCallback onTap;
  final VoidCallback onStar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ocTheme = OpenCodeTheme.of(context);
    final created = DateTime.fromMillisecondsSinceEpoch(item.createdAt);
    final now = DateTime.now();
    final age = now.difference(created);

    String ageLabel;
    if (age.inMinutes < 1) {
      ageLabel = 'just now';
    } else if (age.inHours < 1) {
      ageLabel = '${age.inMinutes}m ago';
    } else if (age.inDays < 1) {
      ageLabel = '${age.inHours}h ago';
    } else {
      ageLabel = '${age.inDays}d ago';
    }

    final backendLabel = item.backend == 'opencode' ? 'OC' : 'CC';
    final summary = (item.summary ?? '').trim();
    final hasSummary = summary.isNotEmpty;
    final smartTags =
        (item.smartTags ?? const []).where((t) => t.trim().isNotEmpty).toList();
    final userTags =
        (item.userTags ?? const []).where((t) => t.trim().isNotEmpty).toList();
    final tagChips = <({String tag, bool isSmart})>[
      for (final t in smartTags) (tag: t, isSmart: true),
      for (final t in userTags) (tag: t, isSmart: false),
    ];

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: ocTheme.backgroundPanel,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: ocTheme.borderSubtle),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    item.filename,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 10),
                _Pill(
                  label: backendLabel,
                  color: item.backend == 'opencode' ? ocTheme.info : ocTheme.primary,
                ),
                const SizedBox(width: 8),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed: onStar,
                  icon: Icon(
                    item.starred ? Icons.star_rounded : Icons.star_border_rounded,
                    color: item.starred ? ocTheme.warning : ocTheme.textMuted,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              '${item.operation.toUpperCase()} • ${item.language} • $ageLabel',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            if (hasSummary) ...[
              const SizedBox(height: 10),
              Text(
                summary,
                style: TextStyle(color: ocTheme.text, fontSize: 13, height: 1.3),
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            if (tagChips.isNotEmpty) ...[
              const SizedBox(height: 10),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  for (final c in tagChips.take(3))
                    _TagChip(
                      label: c.tag,
                      color: c.isSmart ? ocTheme.info : ocTheme.primary,
                    ),
                  if (tagChips.length > 3)
                    _TagChip(
                      label: '+${tagChips.length - 3}',
                      color: ocTheme.textMuted,
                    ),
                ],
              ),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                if (item.additions > 0)
                  Text(
                    '+${item.additions}',
                    style: TextStyle(color: ocTheme.success, fontWeight: FontWeight.w700, fontSize: 12),
                  ),
                if (item.additions > 0 && item.deletions > 0) const SizedBox(width: 8),
                if (item.deletions > 0)
                  Text(
                    '-${item.deletions}',
                    style: TextStyle(color: ocTheme.error, fontWeight: FontWeight.w700, fontSize: 12),
                  ),
                const Spacer(),
                Flexible(
                  child: Text(
                    item.filePath,
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 11),
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.right,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: ocTheme.text,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _TagChip extends StatelessWidget {
  const _TagChip({required this.label, required this.color});
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.2)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: ocTheme.text,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({required this.hasFilter});
  final bool hasFilter;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.inventory_2_outlined, size: 56, color: ocTheme.textMuted),
            const SizedBox(height: 12),
            Text(
              hasFilter ? 'No matches' : 'No artifacts yet',
              style: TextStyle(color: ocTheme.text, fontSize: 16, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              hasFilter
                  ? 'Try clearing filters or searching something else.'
                  : 'Artifacts appear when the agent writes or edits files during chat.',
              style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline_rounded, size: 56, color: ocTheme.error),
            const SizedBox(height: 12),
            Text(
              'Failed to load artifacts',
              style: TextStyle(color: ocTheme.text, fontSize: 16, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
              textAlign: TextAlign.center,
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
