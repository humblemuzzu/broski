import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/claude_code.dart';
import '../models/skill.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import 'markdown_file_editor_screen.dart';

class ClaudeCodeCommandsScreen extends ConsumerStatefulWidget {
  const ClaudeCodeCommandsScreen({super.key});

  @override
  ConsumerState<ClaudeCodeCommandsScreen> createState() =>
      _ClaudeCodeCommandsScreenState();
}

class _ClaudeCodeCommandsScreenState extends ConsumerState<ClaudeCodeCommandsScreen> {
  List<ClaudeCodeCommand> _commands = const [];
  bool _isLoading = true;
  String? _error;

  static final _nameRe = RegExp(r'^[^/\\\s]+$');

  @override
  void initState() {
    super.initState();
    _load();
  }

  SkillSource _sourceFor(ClaudeCodeCommand c) {
    final s = (c.source ?? '').trim();
    if (s == 'project') return SkillSource.project;
    if (s == 'user') return SkillSource.user;
    if (s == 'plugin') return SkillSource.plugin;
    return SkillSource.user;
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
      final commands = await bridge.ccListCommands(cwd: cwd);
      if (!mounted) return;
      setState(() {
        _commands = commands;
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

  Future<void> _open(ClaudeCodeCommand command) async {
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    final bridge = ref.read(bridgeServiceProvider);
    final source = _sourceFor(command);

    try {
      final res = await bridge.ccGetCommandFile(
        name: command.name,
        source: source,
        cwd: cwd,
        path: command.path,
      );
      if (!mounted) return;

      final readOnly = source == SkillSource.plugin;
      final changed = await Navigator.push<bool>(
        context,
        MaterialPageRoute(
          builder: (_) => MarkdownFileEditorScreen(
            title: '/${command.name}',
            source: source,
            readOnly: readOnly,
            initialName: command.name,
            initialContent: res.content,
            path: res.path,
            namePattern: _nameRe,
            nameHint: 'no-spaces-or-slashes',
            onSave: ({
              required name,
              required source,
              required content,
            }) async {
              if (source == SkillSource.plugin) return false;
              return bridge.ccSaveCommandFile(
                name: name,
                source: source,
                content: content,
                cwd: cwd,
              );
            },
            onDelete: readOnly
                ? null
                : () => bridge.ccDeleteCommandFile(
                      name: command.name,
                      source: source,
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
              subtitle: Text('Claude Code custom command'),
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
            'allowed-tools: Read, Write, Bash',
            'argument-hint: [args]',
            '---',
            '',
            r'# Use $ARGUMENTS, $1, $2 placeholders',
            '',
          ].join('\n'),
          namePattern: _nameRe,
          nameHint: 'no-spaces-or-slashes',
          onSave: ({
            required name,
            required source,
            required content,
          }) async {
            return bridge.ccSaveCommandFile(
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

    final bySource = <SkillSource, List<ClaudeCodeCommand>>{};
    for (final c in _commands) {
      bySource.putIfAbsent(_sourceFor(c), () => []).add(c);
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
                              'Select a project to include project/plugin commands.',
                              style: TextStyle(color: oc.textMuted),
                            ),
                          ),
                        if (_commands.isEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 24),
                            child: Center(
                              child: Text(
                                'No commands found',
                                style: TextStyle(color: oc.textMuted),
                              ),
                            ),
                          )
                        else ...[
                          for (final entry in [
                            SkillSource.project,
                            SkillSource.user,
                            SkillSource.plugin,
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
                                (c) => Card(
                                  color: oc.backgroundPanel,
                                  child: ListTile(
                                    title: Text(
                                      '/${c.name}',
                                      style: TextStyle(color: oc.text),
                                    ),
                                    subtitle: Text(
                                      c.description ?? c.path ?? '',
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(color: oc.textMuted),
                                    ),
                                    trailing: Icon(
                                      entry == SkillSource.plugin
                                          ? Icons.lock_outline_rounded
                                          : Icons.chevron_right_rounded,
                                      color: oc.textMuted,
                                    ),
                                    onTap: () => _open(c),
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
