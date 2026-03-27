import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../models/opencode_plugin_file.dart';
import '../models/skill.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
import '../utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';

class OpenCodePluginsScreen extends ConsumerStatefulWidget {
  const OpenCodePluginsScreen({super.key});
  @override
  ConsumerState<OpenCodePluginsScreen> createState() =>
      _OpenCodePluginsScreenState();
}

class _OpenCodePluginsScreenState extends ConsumerState<OpenCodePluginsScreen> {
  List<OpenCodePluginFile> _files = const [];
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final cwd = ref.read(selectionProvider).project?.path;
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final files = await bridge.ocListPluginFiles(cwd: cwd);
      if (!mounted) return;
      setState(() {
        _files = files;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = humanizeError(e);
        _loading = false;
      });
    }
  }

  Future<void> _open(OpenCodePluginFile file) async {
    final cwd = ref.read(selectionProvider).project?.path;
    final bridge = ref.read(bridgeServiceProvider);
    try {
      final data = await bridge.ocGetPluginFile(
        name: file.name,
        source: file.source,
        cwd: cwd,
      );
      if (!mounted || data == null) return;
      final content = data['content'] as String? ?? '';
      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => _PluginEditorScreen(
            title: file.name,
            initialContent: content,
            onSave: (updated) => bridge.ocSavePluginFile(
              name: file.name,
              source: file.source,
              content: updated,
              cwd: cwd,
            ),
          ),
        ),
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Failed to open: ${humanizeError(e)}');
    }
  }

  Future<void> _create() async {
    final cwd = ref.read(selectionProvider).project?.path;
    final sources = <SkillSource>[
      if (cwd != null) SkillSource.project,
      SkillSource.user,
    ];
    final filenameController = TextEditingController(text: 'my-plugin.ts');
    SkillSource selectedSource = sources.first;
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setState) => AlertDialog(
          title: const Text('Create Plugin File'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Filename'),
              SizedBox(height: Spacing.sm),
              TextField(
                controller: filenameController,
                decoration: const InputDecoration(
                  hintText: 'e.g. my-plugin.ts',
                ),
                autofocus: true,
              ),
              SizedBox(height: Spacing.lg),
              const Text('Location'),
              SizedBox(height: Spacing.sm),
              DropdownButton<SkillSource>(
                value: selectedSource,
                isExpanded: true,
                items: sources
                    .map(
                      (s) => DropdownMenuItem(
                        value: s,
                        child: Text(s.displayName),
                      ),
                    )
                    .toList(),
                onChanged: (v) {
                  if (v == null) return;
                  setState(() => selectedSource = v);
                },
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx, false),
              child: const Text('Cancel'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Create'),
            ),
          ],
        ),
      ),
    );
    if (result != true || !mounted) return;
    final filename = filenameController.text.trim();
    if (filename.isEmpty) return;
    final template = '''export const MyPlugin = async (_ctx) => {
  return {
    // Add hook handlers here (see OpenCode docs: Plugins)
    // "tool.execute.before": async (input, output) => {}
  };
};
''';
    final bridge = ref.read(bridgeServiceProvider);
    final ok = await bridge.ocSavePluginFile(
      name: filename,
      source: selectedSource,
      content: template,
      cwd: cwd,
    );
    if (!mounted) return;
    if (!ok) {
      showInfo(context, 'Failed to create plugin file');
    }
    await _load();
  }

  Future<void> _delete(OpenCodePluginFile file) async {
    final cwd = ref.read(selectionProvider).project?.path;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Plugin File'),
        content: Text('Delete "${file.name}" from ${file.source.displayName}?'),
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
    final bridge = ref.read(bridgeServiceProvider);
    final ok = await bridge.ocDeletePluginFile(
      name: file.name,
      source: file.source,
      cwd: cwd,
    );
    if (!mounted) return;
    if (!ok) {
      showInfo(context, 'Failed to delete plugin file');
    }
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final grouped = <SkillSource, List<OpenCodePluginFile>>{};
    for (final f in _files) {
      grouped.putIfAbsent(f.source, () => []).add(f);
    }
    final order = [
      SkillSource.project,
      SkillSource.user,
    ].where(grouped.containsKey).toList();
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text('Plugins', style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          IconButton(
            icon: const Icon(AppIcons.refresh),
            onPressed: _load,
            tooltip: 'Refresh',
          ),
          IconButton(
            icon: const Icon(AppIcons.add),
            onPressed: _create,
            tooltip: 'Create plugin file',
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
            ? Center(
                child: Padding(
                  padding: Insets.cardLg,
                  child: Text(_error!, style: TextStyle(color: oc.textMuted)),
                ),
              )
            : _files.isEmpty
            ? Center(
                child: Padding(
                  padding: Insets.cardLg,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(AppIcons.extension_, color: oc.textMuted, size: 56),
                      SizedBox(height: Spacing.md),
                      Text('No plugin files', style: TextStyle(color: oc.text)),
                      SizedBox(height: Spacing.sm),
                      Text(
                        'Create a plugin file to add OpenCode hooks.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: oc.textMuted),
                      ),
                      SizedBox(height: Spacing.lg),
                      ElevatedButton.icon(
                        onPressed: _create,
                        icon: const Icon(AppIcons.add),
                        label: const Text('Create'),
                      ),
                    ],
                  ),
                ),
              )
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                children: [
                  for (final source in order) ...[
                    Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text(
                        source.displayName.toUpperCase(),
                        style: TextStyle(
                          color: oc.textMuted,
                          fontSize: 11,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.8,
                        ),
                      ),
                    ),
                    ...grouped[source]!.map((f) {
                      return Card(
                        color: oc.backgroundElement,
                        margin: const EdgeInsets.only(bottom: 10),
                        shape: RoundedRectangleBorder(
                          borderRadius: Radii.brMd,
                          side: BorderSide(color: oc.border),
                        ),
                        child: ListTile(
                          onTap: () => _open(f),
                          title: Text(
                            f.name,
                            style: TextStyle(
                              color: oc.text,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(
                            f.path,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTypography.label(color: oc.textMuted),
                          ),
                          trailing: PopupMenuButton<String>(
                            onSelected: (v) {
                              if (v == 'open') _open(f);
                              if (v == 'delete') _delete(f);
                            },
                            itemBuilder: (_) => const [
                              PopupMenuItem(value: 'open', child: Text('Open')),
                              PopupMenuItem(
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

class _PluginEditorScreen extends StatefulWidget {
  const _PluginEditorScreen({
    required this.title,
    required this.initialContent,
    required this.onSave,
  });
  final String title;
  final String initialContent;
  final Future<bool> Function(String content) onSave;
  @override
  State<_PluginEditorScreen> createState() => _PluginEditorScreenState();
}

class _PluginEditorScreenState extends State<_PluginEditorScreen> {
  late final TextEditingController _controller;
  bool _saving = false;
  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialContent);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      final ok = await widget.onSave(_controller.text);
      if (!mounted) return;
      if (ok) {
        Navigator.pop(context);
      } else {
        showError(context, 'Save failed');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        elevation: 0,
        title: Text(widget.title, style: TextStyle(color: oc.text)),
        iconTheme: IconThemeData(color: oc.text),
        actions: [
          if (_saving)
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
            )
          else
            TextButton(
              onPressed: _save,
              child: Text(
                'Save',
                style: TextStyle(
                  color: oc.primary,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: Padding(
          padding: Insets.card,
          child: TextField(
            controller: _controller,
            maxLines: null,
            expands: true,
            style: AppTypography.code(),
            decoration: InputDecoration(
              filled: true,
              fillColor: oc.backgroundElement,
              border: OutlineInputBorder(
                borderRadius: Radii.brMd,
                borderSide: BorderSide(color: oc.border),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
