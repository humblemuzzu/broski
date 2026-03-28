import 'dart:async';

import 'package:broski/models/agent_type.dart';
import 'package:broski/models/skill.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/markdown_styles.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class SkillsScreen extends ConsumerStatefulWidget {
  const SkillsScreen({required this.backend, super.key});
  final AgentType backend;
  @override
  ConsumerState<SkillsScreen> createState() => _SkillsScreenState();
}

class _SkillsScreenState extends ConsumerState<SkillsScreen> {
  List<Skill> _skills = const [];
  bool _isLoading = true;
  String? _error;
  StreamSubscription<Map<String, dynamic>>? _fsSub;
  @override
  void initState() {
    super.initState();
    if (widget.backend == AgentType.claudeCode) {
      final bridge = ref.read(bridgeServiceProvider);
      _fsSub = bridge.messages.listen((msg) {
        if (!mounted) return;
        if (msg['type'] != 'cc_fs_changed') return;
        final data = msg['data'];
        if (data is! Map) return;
        if (data['kind'] != 'skills') return;
        final selection = ref.read(selectionProvider);
        final cwd = selection.project?.path;
        final eventCwd = data['cwd']?.toString();
        if (eventCwd != null && eventCwd.isNotEmpty && cwd != eventCwd) {
          return;
        }
        showInfo(context, 'Skills updated');
        _load(forceReload: true);
      });
    }
    _load();
  }

  @override
  void dispose() {
    _fsSub?.cancel();
    super.dispose();
  }

  Future<void> _load({bool forceReload = false}) async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final skills = await bridge.listSkills(
        backend: widget.backend,
        cwd: cwd,
        forceReload: forceReload,
      );
      final sdkSkills = widget.backend == AgentType.opencode
          ? await bridge.ocListSdkSkills(projectPath: cwd)
          : const <Skill>[];
      if (!mounted) return;
      setState(() {
        _skills = [...skills, ...sdkSkills];
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _isLoading = false;
      });
    }
  }

  Future<void> _openSkill(Skill summary) async {
    // Pi and built-in OpenCode SDK skills are read-only.
    if (widget.backend == AgentType.pi ||
        summary.source == SkillSource.builtin) {
      if (!mounted) return;
      final oc = OpenCodeTheme.of(context);
      final piSource = summary.extra?['piSource'] as String?;
      final sourceLabel = summary.source == SkillSource.builtin
          ? 'OpenCode SDK'
          : (piSource ?? 'extension');
      DetailSheet.show(
        context: context,
        title: summary.name,
        initialSize: 0.5,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (summary.description != null &&
                  summary.description!.trim().isNotEmpty)
                Text(
                  summary.description!,
                  style: TextStyle(color: oc.text, fontSize: 14),
                ),
              if (summary.content != null &&
                  summary.content!.trim().isNotEmpty) ...[
                const SizedBox(height: Spacing.md),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: oc.backgroundElement,
                    borderRadius: Radii.brMd,
                    border: Border.all(color: oc.border),
                  ),
                  child: Text(
                    summary.content!,
                    style: AppTypography.codeSmall(color: oc.text),
                  ),
                ),
              ],
              const SizedBox(height: Spacing.md),
              Text(
                'Source: $sourceLabel',
                style: TextStyle(color: oc.textMuted, fontSize: 13),
              ),
              if (summary.path.isNotEmpty) ...[
                const SizedBox(height: Spacing.xs),
                Text(
                  'Path: ${summary.path}',
                  style: TextStyle(color: oc.textMuted, fontSize: 13),
                ),
              ],
            ],
          ),
        ),
      );
      return;
    }
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    final bridge = ref.read(bridgeServiceProvider);
    try {
      final loaded = await bridge.getSkill(skill: summary, cwd: cwd);
      if (!mounted || loaded == null) return;
      if (!mounted) return;
      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => SkillEditorScreen(
            backend: widget.backend,
            cwd: cwd,
            existing: loaded,
          ),
        ),
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Failed to load skill: ${humanizeError(e)}');
    }
  }

  Future<void> _createSkill() async {
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    final sources = <SkillSource>[
      if (cwd != null) SkillSource.project,
      SkillSource.user,
    ];
    final source = await DetailSheet.show<SkillSource>(
      context: context,
      title: 'Add Skill',
      initialSize: 0.4,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: Insets.listItemDense,
            child: Text(
              widget.backend.displayName,
              style: TextStyle(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          for (final s in sources)
            ListTile(
              leading: Icon(
                s == SkillSource.project ? AppIcons.folder : AppIcons.person,
              ),
              title: Text('${s.displayName} skill'),
              subtitle: Text(
                s == SkillSource.project
                    ? 'Saved in this repo'
                    : 'Available across projects',
              ),
              onTap: () => Navigator.pop(context, s),
            ),
        ],
      ),
    );
    if (source == null || !mounted) return;
    await Navigator.push<void>(
      context,
      MaterialPageRoute(
        builder: (_) => SkillEditorScreen(
          backend: widget.backend,
          cwd: cwd,
          createSource: source,
        ),
      ),
    );
    await _load();
  }

  Future<void> _deleteSkill(Skill skill) async {
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Skill'),
        content: Text(
          'Delete "${skill.name}" from ${skill.source.displayName}?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(ctx).extension<OpenCodeTheme>()!.error,
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.deleteSkill(
        backend: widget.backend,
        name: skill.name,
        source: skill.source,
        cwd: cwd,
      );
      if (!mounted) return;
      if (!ok) {
        showInfo(context, 'Failed to delete skill');
      }
      await _load();
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Failed to delete skill: ${humanizeError(e)}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final oc = theme.extension<OpenCodeTheme>()!;
    final grouped = <SkillSource, List<Skill>>{};
    for (final s in _skills) {
      grouped.putIfAbsent(s.source, () => []).add(s);
    }
    List<SkillSource> orderedSources = [
      SkillSource.project,
      SkillSource.user,
      SkillSource.builtin,
      SkillSource.plugin,
      SkillSource.system,
      SkillSource.admin,
    ];
    orderedSources = orderedSources.where(grouped.containsKey).toList();
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text('Skills', style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          IconButton(
            icon: const Icon(AppIcons.refresh),
            onPressed: () =>
                _load(forceReload: widget.backend == AgentType.codex),
            tooltip: 'Refresh',
          ),
          if (widget.backend != AgentType.pi)
            IconButton(
              icon: const Icon(AppIcons.add),
              onPressed: _createSkill,
              tooltip: 'Create Skill',
            ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
            ? Center(
                child: Padding(
                  padding: Insets.cardLg,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(AppIcons.error, color: oc.error, size: 48),
                      const SizedBox(height: Spacing.md),
                      Text(
                        'Failed to load skills',
                        style: TextStyle(color: oc.text, fontSize: 16),
                      ),
                      const SizedBox(height: Spacing.sm),
                      Text(
                        _error!,
                        textAlign: TextAlign.center,
                        style: AppTypography.label(color: oc.textMuted),
                      ),
                      const SizedBox(height: Spacing.lg),
                      ElevatedButton.icon(
                        onPressed: _load,
                        icon: const Icon(AppIcons.refresh),
                        label: const Text('Retry'),
                      ),
                    ],
                  ),
                ),
              )
            : _skills.isEmpty
            ? Center(
                child: Padding(
                  padding: Insets.cardLg,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(AppIcons.extension_, color: oc.textMuted, size: 56),
                      const SizedBox(height: Spacing.md),
                      Text('No skills found', style: TextStyle(color: oc.text)),
                      const SizedBox(height: Spacing.sm),
                      Text(
                        widget.backend == AgentType.pi
                            ? 'Pi commands come from extensions, skills, and prompt templates.'
                            : 'Create a SKILL.md to teach the agent repeatable workflows.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: oc.textMuted),
                      ),
                      if (widget.backend != AgentType.pi) ...[
                        const SizedBox(height: Spacing.lg),
                        ElevatedButton.icon(
                          onPressed: _createSkill,
                          icon: const Icon(AppIcons.add),
                          label: const Text('Create Skill'),
                        ),
                      ],
                    ],
                  ),
                ),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                children: [
                  _BackendHeader(backend: widget.backend),
                  const SizedBox(height: Spacing.md),
                  for (final source in orderedSources) ...[
                    _SectionHeader(title: source.displayName),
                    const SizedBox(height: 6),
                    ...grouped[source]!.map((skill) {
                      final editable = skill.source.isEditable;
                      return Card(
                        color: oc.backgroundElement,
                        margin: const EdgeInsets.only(bottom: 10),
                        shape: RoundedRectangleBorder(
                          borderRadius: Radii.brMd,
                          side: BorderSide(color: oc.border),
                        ),
                        child: ListTile(
                          onTap: () => _openSkill(skill),
                          title: Row(
                            children: [
                              Flexible(
                                child: Text(
                                  skill.name,
                                  style: TextStyle(
                                    color: oc.text,
                                    fontWeight: FontWeight.w600,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (skill.extra?['agent'] != null) ...[
                                const SizedBox(width: 6),
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 6,
                                    vertical: 2,
                                  ),
                                  decoration: BoxDecoration(
                                    color: oc.primary.withValues(alpha: 0.15),
                                    borderRadius: Radii.brXs,
                                  ),
                                  child: Text(
                                    skill.extra!['agent'].toString(),
                                    style: TextStyle(
                                      color: oc.primary,
                                      fontSize: 10,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              ],
                            ],
                          ),
                          subtitle: Text(
                            skill.description?.trim().isNotEmpty == true
                                ? skill.description!.trim()
                                : 'No description',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: oc.textMuted),
                          ),
                          trailing: PopupMenuButton<String>(
                            onSelected: (value) {
                              if (value == 'open') _openSkill(skill);
                              if (value == 'delete') _deleteSkill(skill);
                            },
                            itemBuilder: (context) => [
                              const PopupMenuItem(
                                value: 'open',
                                child: Text('Open'),
                              ),
                              if (editable)
                                const PopupMenuItem(
                                  value: 'delete',
                                  child: Text('Delete'),
                                ),
                            ],
                          ),
                        ),
                      );
                    }),
                  ],
                ],
              ),
      ),
    );
  }
}

class SkillEditorScreen extends ConsumerStatefulWidget {
  const SkillEditorScreen({
    required this.backend,
    required this.cwd,
    this.existing,
    this.createSource,
    super.key,
  });
  final AgentType backend;
  final String? cwd;
  final Skill? existing;
  final SkillSource? createSource;
  @override
  ConsumerState<SkillEditorScreen> createState() => _SkillEditorScreenState();
}

class _SkillEditorScreenState extends ConsumerState<SkillEditorScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  late final TextEditingController _name;
  late final TextEditingController _content;
  bool _isSaving = false;
  String? _loadError;
  bool get _isCreate => widget.existing == null;
  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _name = TextEditingController(text: widget.existing?.name ?? '');
    _content = TextEditingController(text: widget.existing?.content ?? '');
    if (_isCreate) {
      _content.text = _template(
        name: _name.text.trim().isEmpty ? 'my-skill' : _name.text.trim(),
        description: 'Describe when to use this skill',
      );
    } else if ((widget.existing?.content ?? '').isEmpty) {
      _loadExisting();
    }
  }

  @override
  void dispose() {
    _tabs.dispose();
    _name.dispose();
    _content.dispose();
    super.dispose();
  }

  String _template({required String name, required String description}) {
    return '''---
name: $name
description: $description
# agent: my-agent  # Optional: agent type for execution (SDK v2.1.0)
# context: fork    # Optional: run in forked sub-agent context (SDK v2.1.0)
---
# $name
## When to use
- …
## How to use
- …
''';
  }

  String _stripFrontmatter(String raw) {
    final match = RegExp(
      r'^---\n[\s\S]*?\n---\n?',
      multiLine: false,
    ).firstMatch(raw);
    if (match == null) return raw;
    return raw.substring(match.end);
  }

  Future<void> _loadExisting() async {
    setState(() => _loadError = null);
    try {
      final selection = ref.read(selectionProvider);
      final cwd = widget.cwd ?? selection.project?.path;
      final bridge = ref.read(bridgeServiceProvider);
      final loaded = await bridge.getSkill(skill: widget.existing!, cwd: cwd);
      if (!mounted || loaded == null) return;
      setState(() => _content.text = loaded.content ?? '');
    } catch (e) {
      if (!mounted) return;
      setState(() => _loadError = humanizeError(e));
    }
  }

  Future<void> _save() async {
    final selection = ref.read(selectionProvider);
    final cwd = widget.cwd ?? selection.project?.path;
    final name = _isCreate ? _name.text.trim() : widget.existing!.name;
    if (name.isEmpty) {
      showInfo(context, 'Skill name is required');
      return;
    }
    final nameOk =
        RegExp(r'^[a-z0-9]+(-[a-z0-9]+)*$').hasMatch(name) && name.length <= 64;
    if (!nameOk) {
      showInfo(context, 'Invalid skill name (use lowercase a-z, 0-9, hyphens)');
      return;
    }
    final source = _isCreate ? widget.createSource : widget.existing!.source;
    if (source == null) return;
    if (!source.isEditable) {
      showInfo(context, 'This skill is read-only');
      return;
    }
    if (source == SkillSource.project && cwd == null) {
      showInfo(context, 'Select a project to create repo skills');
      return;
    }
    if (_isCreate) {
      final raw = _content.text;
      final fm = RegExp(
        r'^---\n([\s\S]*?)\n---',
        multiLine: false,
      ).firstMatch(raw)?.group(1);
      final fmName = fm != null
          ? RegExp(
              r'^name:\s*(.+?)\s*$',
              multiLine: true,
            ).firstMatch(fm)?.group(1)?.trim()
          : null;
      if (fmName != null && fmName != name) {
        final fix = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Fix SKILL.md name?'),
            content: Text(
              'Frontmatter name is "$fmName", but the folder will be "$name".\n\nUpdate the frontmatter to match?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Keep'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.pop(ctx, true),
                child: const Text('Update'),
              ),
            ],
          ),
        );
        if (fix == true) {
          final updated = raw.replaceFirst(
            RegExp(r'^name:\s*.+?\s*$', multiLine: true),
            'name: $name',
          );
          _content.text = updated;
        }
      }
    }
    setState(() => _isSaving = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.saveSkill(
        backend: widget.backend,
        name: name,
        source: source,
        content: _content.text,
        cwd: cwd,
      );
      if (!mounted) return;
      if (ok) {
        Navigator.pop(context);
      } else {
        showError(context, 'Failed to save "$name"');
      }
    } catch (e) {
      if (!mounted) return;
      showError(context, 'Failed to save: ${humanizeError(e)}');
    } finally {
      if (mounted) setState(() => _isSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final oc = theme.extension<OpenCodeTheme>()!;
    final existing = widget.existing;
    final source = existing?.source ?? widget.createSource;
    final readOnly = existing != null && !existing.source.isEditable;
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text(
          _isCreate ? 'Create Skill' : existing!.name,
          style: TextStyle(color: oc.text),
        ),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          if (!_isSaving)
            TextButton(
              onPressed: readOnly ? null : _save,
              child: Text(
                'Save',
                style: TextStyle(
                  color: readOnly ? oc.textMuted : oc.primary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            )
          else
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: oc.primary,
                ),
              ),
            ),
        ],
        bottom: TabBar(
          controller: _tabs,
          labelColor: oc.primary,
          unselectedLabelColor: oc.textMuted,
          indicatorColor: oc.primary,
          tabs: const [
            Tab(text: 'Edit'),
            Tab(text: 'Preview'),
          ],
        ),
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: Column(
          children: [
            if (_loadError != null)
              Padding(
                padding: Insets.cardSm,
                child: Text(_loadError!, style: TextStyle(color: oc.error)),
              ),
            if (_isCreate)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Name',
                      style: AppTypography.label(color: oc.textMuted),
                    ),
                    const SizedBox(height: 6),
                    TextField(
                      controller: _name,
                      decoration: const InputDecoration(
                        hintText: 'e.g. api-docs, code-reviewer',
                      ),
                    ),
                    const SizedBox(height: 10),
                    if (source != null)
                      Text(
                        'Location: ${source.displayName}${readOnly ? ' (read-only)' : ''}',
                        style: AppTypography.label(color: oc.textMuted),
                      ),
                  ],
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                child: Row(
                  children: [
                    _Chip(label: widget.backend.displayName),
                    const SizedBox(width: Spacing.sm),
                    if (source != null) _Chip(label: source.displayName),
                    if (readOnly) ...[
                      const SizedBox(width: Spacing.sm),
                      const _Chip(label: 'Read-only', tone: ChipTone.warn),
                    ],
                  ],
                ),
              ),
            const SizedBox(height: Spacing.md),
            Expanded(
              child: TabBarView(
                controller: _tabs,
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    child: TextField(
                      controller: _content,
                      maxLines: null,
                      expands: true,
                      readOnly: readOnly,
                      style: AppTypography.code(),
                      decoration: InputDecoration(
                        hintText: 'SKILL.md content',
                        filled: true,
                        fillColor: oc.backgroundElement,
                        border: OutlineInputBorder(
                          borderRadius: Radii.brMd,
                          borderSide: BorderSide(color: oc.border),
                        ),
                      ),
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    color: oc.background,
                    child: Markdown(
                      data: _stripFrontmatter(_content.text),
                      selectable: true,
                      styleSheet: MarkdownStyles.fileViewer(oc),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

enum ChipTone { normal, warn }

class _Chip extends StatelessWidget {
  const _Chip({required this.label, this.tone = ChipTone.normal});
  final String label;
  final ChipTone tone;
  @override
  Widget build(BuildContext context) {
    final oc = Theme.of(context).extension<OpenCodeTheme>()!;
    final color = tone == ChipTone.warn ? oc.warning : oc.primary;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: Radii.brFull,
        border: Border.all(color: color.withValues(alpha: 0.25)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _BackendHeader extends StatelessWidget {
  const _BackendHeader({required this.backend});
  final AgentType backend;
  @override
  Widget build(BuildContext context) {
    final oc = Theme.of(context).extension<OpenCodeTheme>()!;
    return Container(
      padding: Insets.cardMd,
      decoration: BoxDecoration(
        color: oc.backgroundPanel,
        borderRadius: Radii.brLg,
        border: Border.all(color: oc.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(AppIcons.autoFix, color: oc.primary, size: 18),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '${backend.displayName} skills',
              style: TextStyle(color: oc.text, fontWeight: FontWeight.w700),
            ),
          ),
          Text(
            'SKILL.md',
            style: TextStyle(
              color: oc.textMuted,
              fontSize: 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;
  @override
  Widget build(BuildContext context) {
    final oc = Theme.of(context).extension<OpenCodeTheme>()!;
    return Padding(
      padding: const EdgeInsets.only(top: 4, bottom: 2),
      child: Text(
        title.toUpperCase(),
        style: TextStyle(
          color: oc.textMuted,
          fontSize: 11,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.8,
        ),
      ),
    );
  }
}
