import 'package:broski/providers/selection_provider.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
        _error = humanizeError(e);
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
        showInfo(context, 'Saved');
      } else {
        showInfo(context, 'Save failed');
      }
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Save failed: ${humanizeError(e)}');
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
            icon: const Icon(AppIcons.refresh),
          ),
          IconButton(
            tooltip: 'Save',
            onPressed: _loading || _saving || !hasProject ? null : _save,
            icon: const Icon(AppIcons.save),
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: SafeArea(
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
      ),
    );
  }
}
