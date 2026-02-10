import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../theme/app_typography.dart';
import '../theme/design_tokens.dart';

import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';

class CodexAgentsScreen extends ConsumerStatefulWidget {
  const CodexAgentsScreen({super.key});

  @override
  ConsumerState<CodexAgentsScreen> createState() => _CodexAgentsScreenState();
}

class _CodexAgentsScreenState extends ConsumerState<CodexAgentsScreen> {
  final _ctrl = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  String? _path;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    if (cwd == null || cwd.isEmpty) {
      setState(() {
        _loading = false;
        _ctrl.text = '';
        _path = null;
      });
      return;
    }

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final data = await bridge.cxReadAgentsMd(cwd);
      if (!mounted) return;
      setState(() {
        _path = data['path'] as String?;
        _ctrl.text = data['content'] as String? ?? '';
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

  Future<void> _save() async {
    if (_saving) return;
    final selection = ref.read(selectionProvider);
    final cwd = selection.project?.path;
    if (cwd == null || cwd.isEmpty) return;

    setState(() => _saving = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final ok = await bridge.cxWriteAgentsMd(cwd: cwd, content: _ctrl.text);
      if (!mounted) return;
      if (ok) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Saved')));
      } else {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('Save failed')));
      }
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Save failed: $e')));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    final selection = ref.watch(selectionProvider);
    final hasProject = selection.project?.path.isNotEmpty == true;

    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        foregroundColor: oc.text,
        title: Text('Agents', style: TextStyle(color: oc.text)),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            onPressed: _loading ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
          IconButton(
            tooltip: 'Save',
            onPressed: _loading || _saving || !hasProject ? null : _save,
            icon: const Icon(Icons.save_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: _loading
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
            : !hasProject
            ? Center(
                child: Padding(
                  padding: Insets.card,
                  child: Text(
                    'Select a project to edit `AGENTS.md`.',
                    style: TextStyle(color: oc.textMuted),
                    textAlign: TextAlign.center,
                  ),
                ),
              )
            : Padding(
                padding: Insets.card,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if ((_path ?? '').isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Text(
                          _path!,
                          style: AppTypography.label(color: oc.textMuted),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    Expanded(
                      child: TextField(
                        controller: _ctrl,
                        expands: true,
                        minLines: null,
                        maxLines: null,
                        style: AppTypography.code(color: oc.text),
                        decoration: InputDecoration(
                          labelText: 'AGENTS.md',
                          alignLabelWithHint: true,
                          filled: true,
                          fillColor: oc.backgroundPanel,
                          border: OutlineInputBorder(
                            borderRadius: Radii.brMd,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}
