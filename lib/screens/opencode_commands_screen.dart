import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/opencode_markdown_file.dart';
import '../models/skill.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import 'markdown_file_editor_screen.dart';

class OpenCodeCommandsScreen extends ConsumerStatefulWidget {
  const OpenCodeCommandsScreen({super.key});

  @override
  ConsumerState<OpenCodeCommandsScreen> createState() =>
      _OpenCodeCommandsScreenState();
}

class _OpenCodeCommandsScreenState extends ConsumerState<OpenCodeCommandsScreen> {
  List<OpenCodeMarkdownFile> _files = const [];
  bool _isLoading = true;
  String? _error;

  static final _nameRe = RegExp(r'^[a-z0-9]+(-[a-z0-9]+)*$');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    final bridge = ref.read(bridgeServiceProvider);

    try {
      final files = await bridge.ocListCommandFiles(cwd: cwd);
      if (!mounted) return;
      setState(() {
        _files = files;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  Future<void> _open(OpenCodeMarkdownFile file) async {
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    final bridge = ref.read(bridgeServiceProvider);

    try {
      final res = await bridge.ocGetCommandFile(
        name: file.name,
        source: file.source,
        cwd: cwd,
      );
      if (!mounted) return;
      final changed = await Navigator.push<bool>(
        context,
        MaterialPageRoute(
          builder: (_) => MarkdownFileEditorScreen(
            title: '/${file.name}',
            source: file.source,
            initialName: file.name,
            initialContent: res.content,
            path: res.path,
            namePattern: _nameRe,
            nameHint: 'lowercase-with-dashes',
            onSave: ({
              required name,
              required source,
              required content,
            }) async {
              return bridge.ocSaveCommandFile(
                name: name,
                source: source,
                content: content,
                cwd: cwd,
              );
            },
            onDelete: () => bridge.ocDeleteCommandFile(
              name: file.name,
              source: file.source,
              cwd: cwd,
            ),
          ),
        ),
      );
      if (changed == true) await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to load command: $e')),
      );
    }
  }

  Future<void> _create() async {
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;

    final sources = <SkillSource>[
      if (cwd != null) SkillSource.project,
      SkillSource.user,
    ];

    final source = await showModalBottomSheet<SkillSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const ListTile(
              title: Text('Create Command'),
              subtitle: Text('OpenCode custom command'),
            ),
            const Divider(height: 1),
            for (final s in sources)
              ListTile(
                leading: Icon(
                  s == SkillSource.project
                      ? Icons.folder_outlined
                      : Icons.person_outline_rounded,
                ),
                title: Text(s.displayName),
                onTap: () => Navigator.pop(context, s),
              ),
          ],
        ),
      ),
    );

    if (source == null) return;
    final bridge = ref.read(bridgeServiceProvider);

    if (!mounted) return;
    final changed = await Navigator.push<bool>(
      context,
      MaterialPageRoute(
        builder: (_) => MarkdownFileEditorScreen(
          title: 'New Command',
          source: source,
          initialName: '',
          initialContent: const [
            '---',
            'description: Describe what this command does',
            'subtask: false',
            '---',
            '',
            r'# Use $ARGUMENTS, $1, $2 placeholders',
            '',
          ].join('\n'),
          namePattern: _nameRe,
          nameHint: 'lowercase-with-dashes',
          onSave: ({
            required name,
            required source,
            required content,
          }) async {
            return bridge.ocSaveCommandFile(
              name: name,
              source: source,
              content: content,
              cwd: cwd,
            );
          },
        ),
      ),
    );
    if (changed == true) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final selection = ref.watch(selectionProvider);

    final bySource = <SkillSource, List<OpenCodeMarkdownFile>>{};
    for (final f in _files) {
      bySource.putIfAbsent(f.source, () => []).add(f);
    }

    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        foregroundColor: oc.text,
        title: Text('Commands', style: TextStyle(color: oc.text)),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _isLoading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
          IconButton(
            tooltip: 'Add',
            onPressed: _create,
            icon: const Icon(Icons.add_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(
                        _error!,
                        style: TextStyle(color: oc.textMuted),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                : RefreshIndicator(
                    onRefresh: _load,
                    child: ListView(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                      children: [
                        if (selection.project == null)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 12),
                            child: Text(
                              'Select a project to manage project-level commands.',
                              style: TextStyle(color: oc.textMuted),
                            ),
                          ),
                        if (_files.isEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 24),
                            child: Center(
                              child: Text(
                                'No custom commands found',
                                style: TextStyle(color: oc.textMuted),
                              ),
                            ),
                          )
                        else ...[
                          for (final entry in [
                            SkillSource.project,
                            SkillSource.user,
                          ])
                            if (bySource[entry]?.isNotEmpty == true) ...[
                              Padding(
                                padding: const EdgeInsets.only(
                                  top: 12,
                                  bottom: 6,
                                ),
                                child: Text(
                                  entry.displayName,
                                  style: TextStyle(
                                    color: oc.textMuted,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              ...bySource[entry]!.map(
                                (f) => Card(
                                  color: oc.backgroundPanel,
                                  child: ListTile(
                                    title: Text(
                                      '/${f.name}',
                                      style: TextStyle(color: oc.text),
                                    ),
                                    subtitle: Text(
                                      f.description ?? f.path,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(color: oc.textMuted),
                                    ),
                                    trailing: Icon(
                                      Icons.chevron_right_rounded,
                                      color: oc.textMuted,
                                    ),
                                    onTap: () => _open(f),
                                  ),
                                ),
                              ),
                            ],
                        ],
                      ],
                    ),
                  ),
      ),
    );
  }
}
