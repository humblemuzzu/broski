import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/artifact.dart';
import '../models/message.dart';
import '../models/project.dart';
import '../models/session.dart';
import '../providers/artifacts_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import '../widgets/diff_viewer.dart';
import '../widgets/file_viewers/unified_file_viewer.dart';
import 'chat_screen.dart';
import 'diff_view_screen.dart';

class ArtifactDetailScreen extends ConsumerStatefulWidget {
  const ArtifactDetailScreen({super.key, required this.artifactId});

  final String artifactId;

  @override
  ConsumerState<ArtifactDetailScreen> createState() =>
      _ArtifactDetailScreenState();
}

class _ArtifactDetailScreenState extends ConsumerState<ArtifactDetailScreen> {
  Artifact? _artifact;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    Future.microtask(_load);
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final artifact = await bridge.getArtifact(widget.artifactId);
      if (!mounted) return;
      setState(() {
        _artifact = artifact;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final artifact = _artifact;

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.background,
        foregroundColor: ocTheme.text,
        elevation: 0,
        title: Text(artifact?.filename ?? 'Artifact'),
        actions: [
          if (artifact != null)
            IconButton(
              tooltip: artifact.starred ? 'Unstar' : 'Star',
              onPressed: () => _toggleStar(artifact),
              icon: Icon(
                artifact.starred
                    ? Icons.star_rounded
                    : Icons.star_border_rounded,
                color: artifact.starred ? ocTheme.warning : ocTheme.textMuted,
              ),
            ),
          IconButton(
            tooltip: 'Refresh',
            onPressed: _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: ocTheme.primary))
          : _error != null
          ? _ErrorState(message: _error!, onRetry: _load)
          : artifact == null
          ? _ErrorState(message: 'Artifact not found', onRetry: _load)
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              children: [
                _HeaderCard(artifact: artifact),
                const SizedBox(height: 12),
                _ActionsCard(
                  artifact: artifact,
                  onOpenChat: () => _openSourceChat(artifact),
                ),
                const SizedBox(height: 12),
                _TagsSection(
                  artifact: artifact,
                  onAddTag: () => _addUserTag(artifact),
                  onRemoveUserTag: (tag) => _removeUserTag(artifact, tag),
                ),
                const SizedBox(height: 12),
                if ((artifact.unifiedDiff ?? '').trim().isNotEmpty ||
                    ((artifact.contentBefore ?? '').isNotEmpty ||
                        (artifact.contentAfter ?? '').isNotEmpty))
                  _DiffSection(artifact: artifact),
                const SizedBox(height: 12),
                _ContentSection(artifact: artifact),
                const SizedBox(height: 12),
                _NotesSection(
                  artifact: artifact,
                  onEdit: () => _editNotes(artifact),
                ),
              ],
            ),
    );
  }

  Future<void> _toggleStar(Artifact artifact) async {
    final bridge = ref.read(bridgeServiceProvider);
    final ok = await bridge.updateArtifact(
      id: artifact.id,
      starred: !artifact.starred,
    );
    if (!ok || !mounted) return;

    setState(() {
      _artifact = artifact.copyWith(starred: !artifact.starred);
    });

    ref.read(artifactsProvider.notifier).refresh();
  }

  Future<void> _editNotes(Artifact artifact) async {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController(text: artifact.notes ?? '');
    final next = await showDialog<String?>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: ocTheme.backgroundPanel,
        title: Text(
          'Notes',
          style: TextStyle(color: ocTheme.text, fontWeight: FontWeight.w700),
        ),
        content: TextField(
          controller: controller,
          maxLines: 6,
          style: TextStyle(color: ocTheme.text),
          decoration: InputDecoration(
            hintText: 'Add a note…',
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
            child: const Text('Save'),
          ),
        ],
      ),
    );

    if (next == null) return;

    final bridge = ref.read(bridgeServiceProvider);
    final ok = await bridge.updateArtifact(id: artifact.id, notes: next);
    if (!ok || !mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: const Text('Notes saved'),
        behavior: SnackBarBehavior.floating,
        backgroundColor: ocTheme.backgroundPanel,
        duration: const Duration(seconds: 2),
      ),
    );
    await _load();
    ref.read(artifactsProvider.notifier).refresh();
  }

  Future<void> _addUserTag(Artifact artifact) async {
    final ocTheme = OpenCodeTheme.of(context);
    final controller = TextEditingController();
    final next = await showDialog<String?>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: ocTheme.backgroundPanel,
        title: Text(
          'Add tag',
          style: TextStyle(color: ocTheme.text, fontWeight: FontWeight.w700),
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: TextStyle(color: ocTheme.text),
          decoration: InputDecoration(
            hintText: 'e.g. auth',
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
            child: const Text('Add'),
          ),
        ],
      ),
    );

    final cleaned = (next ?? '').trim();
    if (cleaned.isEmpty) return;

    final existing = artifact.userTags ?? const [];
    final nextTags = {
      for (final t in existing) t.trim(),
      cleaned,
    }.where((t) => t.isNotEmpty).toList()
      ..sort();

    final bridge = ref.read(bridgeServiceProvider);
    final ok = await bridge.updateArtifact(id: artifact.id, userTags: nextTags);
    if (!ok || !mounted) return;
    await _load();
    ref.read(artifactsProvider.notifier).refresh();
  }

  Future<void> _removeUserTag(Artifact artifact, String tag) async {
    final existing = artifact.userTags ?? const [];
    final nextTags = existing.where((t) => t != tag).toList();
    final bridge = ref.read(bridgeServiceProvider);
    final ok = await bridge.updateArtifact(id: artifact.id, userTags: nextTags);
    if (!ok || !mounted) return;
    await _load();
    ref.read(artifactsProvider.notifier).refresh();
  }

  Future<void> _openSourceChat(Artifact artifact) async {
    final ocTheme = OpenCodeTheme.of(context);
    final bridge = ref.read(bridgeServiceProvider);

    try {
      if (artifact.backend == 'claude-code') {
        final session = await bridge.ccGetSession(artifact.sessionId, cwd: artifact.projectPath);
        if (!mounted) return;
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) => ChatScreen.claudeCode(ccSession: session),
          ),
        );
        return;
      }

      final session = await bridge.getSession(
        artifact.sessionId,
        projectPath: artifact.projectPath,
      );
      if (!mounted) return;
      final project = ProjectSummary(
        id: artifact.projectPath,
        name: artifact.projectPath.split('/').last,
        path: artifact.projectPath,
      );
      Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => ChatScreen(project: project, session: session),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Failed to open chat: $e'),
          behavior: SnackBarBehavior.floating,
          backgroundColor: ocTheme.backgroundPanel,
        ),
      );
    }
  }
}

class _HeaderCard extends StatelessWidget {
  const _HeaderCard({required this.artifact});

  final Artifact artifact;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final created = DateTime.fromMillisecondsSinceEpoch(artifact.createdAt);
    return Container(
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
                  artifact.filePath,
                  style: TextStyle(
                    color: ocTheme.text,
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 10),
              _Pill(
                label: artifact.backend == 'opencode' ? 'OpenCode' : 'Claude Code',
                color: artifact.backend == 'opencode' ? ocTheme.info : ocTheme.primary,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '${artifact.operation.toUpperCase()} • ${artifact.tool} • ${artifact.language}',
            style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
          ),
          const SizedBox(height: 6),
          Text(
            'Created ${created.toLocal()}',
            style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
          ),
          if ((artifact.summary ?? '').trim().isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              artifact.summary!.trim(),
              style: TextStyle(color: ocTheme.text, fontSize: 13, height: 1.3),
            ),
          ],
        ],
      ),
    );
  }
}

class _DiffSection extends StatelessWidget {
  const _DiffSection({required this.artifact});

  final Artifact artifact;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final diff = DiffEntry(
      file: artifact.filePath,
      before: artifact.contentBefore ?? '',
      after: artifact.contentAfter ?? '',
      additions: artifact.additions,
      deletions: artifact.deletions,
      diff: artifact.unifiedDiff,
      partId: null,
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Diff',
          style: TextStyle(color: ocTheme.text, fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        DiffViewer(
          diff: diff,
          messageId: artifact.messageId ?? 'artifact',
          onUndo: null,
          onViewFull: () {
            Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => DiffViewScreen(diff: diff)),
            );
          },
        ),
      ],
    );
  }
}

class _ActionsCard extends StatelessWidget {
  const _ActionsCard({required this.artifact, required this.onOpenChat});

  final Artifact artifact;
  final VoidCallback onOpenChat;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: ocTheme.backgroundPanel,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: ocTheme.borderSubtle),
      ),
      child: Row(
        children: [
          Expanded(
            child: ElevatedButton.icon(
              onPressed: artifact.sessionId.isEmpty ? null : onOpenChat,
              icon: const Icon(Icons.chat_bubble_outline_rounded),
              label: const Text('Open chat'),
            ),
          ),
        ],
      ),
    );
  }
}

class _TagsSection extends StatelessWidget {
  const _TagsSection({
    required this.artifact,
    required this.onAddTag,
    required this.onRemoveUserTag,
  });

  final Artifact artifact;
  final VoidCallback onAddTag;
  final ValueChanged<String> onRemoveUserTag;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final smart = (artifact.smartTags ?? const []).where((t) => t.trim().isNotEmpty).toList();
    final user = (artifact.userTags ?? const []).where((t) => t.trim().isNotEmpty).toList();

    Widget buildChip(String label, {required Color color, VoidCallback? onDelete}) {
      return Container(
        margin: const EdgeInsets.only(right: 8, bottom: 8),
        child: Chip(
          label: Text(label),
          labelStyle: TextStyle(color: ocTheme.text, fontSize: 12, fontWeight: FontWeight.w600),
          backgroundColor: color.withValues(alpha: 0.12),
          side: BorderSide(color: color.withValues(alpha: 0.25)),
          deleteIcon: onDelete != null ? Icon(Icons.close_rounded, size: 16, color: ocTheme.textMuted) : null,
          onDeleted: onDelete,
        ),
      );
    }

    return Container(
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
              Text(
                'Tags',
                style: TextStyle(color: ocTheme.text, fontWeight: FontWeight.w700),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: onAddTag,
                icon: const Icon(Icons.add_rounded, size: 16),
                label: const Text('Add'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (smart.isEmpty && user.isEmpty)
            Text(
              'No tags yet.',
              style: TextStyle(color: ocTheme.textMuted),
            )
          else
            Wrap(
              children: [
                for (final t in smart) buildChip(t, color: ocTheme.info),
                for (final t in user)
                  buildChip(
                    t,
                    color: ocTheme.primary,
                    onDelete: () => onRemoveUserTag(t),
                  ),
              ],
            ),
        ],
      ),
    );
  }
}

class _ContentSection extends StatelessWidget {
  const _ContentSection({required this.artifact});

  final Artifact artifact;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final content = artifact.contentAfter ?? '';

    return Container(
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
              Text(
                'Content',
                style: TextStyle(color: ocTheme.text, fontWeight: FontWeight.w700),
              ),
              const Spacer(),
              IconButton(
                tooltip: 'Copy',
                onPressed: content.trim().isEmpty
                    ? null
                    : () async {
                        await Clipboard.setData(ClipboardData(text: content));
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: const Text('Copied'),
                            behavior: SnackBarBehavior.floating,
                            backgroundColor: ocTheme.backgroundElement,
                            duration: const Duration(seconds: 2),
                          ),
                        );
                      },
                icon: const Icon(Icons.copy_rounded),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (content.trim().isEmpty)
            Text(
              'No content snapshot available for this artifact.',
              style: TextStyle(color: ocTheme.textMuted),
            )
          else
            Container(
              decoration: BoxDecoration(
                color: ocTheme.backgroundElement,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: ocTheme.borderSubtle),
              ),
              clipBehavior: Clip.antiAlias,
              child: UnifiedFileViewer(
                filePath: artifact.filePath,
                textContent: content,
              ),
            ),
        ],
      ),
    );
  }
}

class _NotesSection extends StatelessWidget {
  const _NotesSection({required this.artifact, required this.onEdit});

  final Artifact artifact;
  final VoidCallback onEdit;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final notes = (artifact.notes ?? '').trim();

    return Container(
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
              Text(
                'Notes',
                style: TextStyle(color: ocTheme.text, fontWeight: FontWeight.w700),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: onEdit,
                icon: const Icon(Icons.edit_rounded, size: 16),
                label: const Text('Edit'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            notes.isEmpty ? 'No notes yet.' : notes,
            style: TextStyle(color: notes.isEmpty ? ocTheme.textMuted : ocTheme.text),
          ),
        ],
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
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
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
              'Something went wrong',
              style: TextStyle(color: ocTheme.text, fontSize: 16, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: TextStyle(color: ocTheme.textMuted, fontSize: 13),
              textAlign: TextAlign.center,
              maxLines: 4,
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
