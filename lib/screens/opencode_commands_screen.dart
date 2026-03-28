import 'package:broski/models/opencode_markdown_file.dart';
import 'package:broski/models/skill.dart';
import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/screens/markdown_file_editor_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class OpenCodeCommandsScreen extends ConsumerStatefulWidget {
  const OpenCodeCommandsScreen({super.key});
  @override
  ConsumerState<OpenCodeCommandsScreen> createState() =>
      _OpenCodeCommandsScreenState();
}

class _OpenCodeCommandsScreenState
    extends ConsumerState<OpenCodeCommandsScreen> {
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
        _error = humanizeError(e);
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
            onSave: ({required name, required source, required content}) async {
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
      showInfo(context, 'Failed to load command: ${humanizeError(e)}');
    }
  }

  Future<void> _create() async {
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    final sources = <SkillSource>[
      if (cwd != null) SkillSource.project,
      SkillSource.user,
    ];
    final source = await DetailSheet.show<SkillSource>(
      context: context,
      title: 'Add Command',
      initialSize: 0.4,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: Insets.listItemDense,
            child: Text(
              'OpenCode custom command',
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
              title: Text(s.displayName),
              onTap: () => Navigator.pop(context, s),
            ),
        ],
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
          onSave: ({required name, required source, required content}) async {
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
            icon: const Icon(AppIcons.refresh),
          ),
          IconButton(
            tooltip: 'Add',
            onPressed: _create,
            icon: const Icon(AppIcons.add),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: SafeArea(
          child: _isLoading
              ? const Center(child: CircularProgressIndicator())
              : _error != null
              ? Center(
                  child: Padding(
                    padding: Insets.card,
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
                          padding: Insets.bottomMd,
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
                                    AppIcons.chevronRight,
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
      ),
    );
  }
}
