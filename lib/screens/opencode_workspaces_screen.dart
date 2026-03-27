import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/theme/app_icons.dart';
import '../utils/error_utils.dart';
import 'package:broski/utils/snackbar_helpers.dart';

class OpenCodeWorkspacesScreen extends ConsumerStatefulWidget {
  const OpenCodeWorkspacesScreen({super.key});
  @override
  ConsumerState<OpenCodeWorkspacesScreen> createState() =>
      _OpenCodeWorkspacesScreenState();
}

class _OpenCodeWorkspacesScreenState
    extends ConsumerState<OpenCodeWorkspacesScreen> {
  List<Map<String, dynamic>> _workspaces = const [];
  bool _isLoading = true;
  String? _error;

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
    final cwd = ref.read(selectionProvider).project?.path;
    final bridge = ref.read(bridgeServiceProvider);
    try {
      final list = await bridge.ocListWorkspaces(projectPath: cwd);
      if (!mounted) return;
      setState(() {
        _workspaces = list;
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

  Future<void> _create() async {
    final idCtrl = TextEditingController();
    final branchCtrl = TextEditingController();
    final result = await showDialog<(String, String?)>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Create Workspace'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: idCtrl,
              decoration: const InputDecoration(
                labelText: 'Workspace ID',
                hintText: 'my-workspace',
              ),
              autofocus: true,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: branchCtrl,
              decoration: const InputDecoration(
                labelText: 'Branch (optional)',
                hintText: 'main',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () {
              final id = idCtrl.text.trim();
              if (id.isEmpty) return;
              final branch = branchCtrl.text.trim().isEmpty
                  ? null
                  : branchCtrl.text.trim();
              Navigator.pop(ctx, (id, branch));
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
    idCtrl.dispose();
    branchCtrl.dispose();
    if (result == null) return;
    final (id, branch) = result;
    final cwd = ref.read(selectionProvider).project?.path;
    final bridge = ref.read(bridgeServiceProvider);
    try {
      await bridge.ocCreateWorkspace(id: id, branch: branch, projectPath: cwd);
      if (!mounted) return;
      await _load();
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Failed to create workspace: ${humanizeError(e)}');
    }
  }

  Future<void> _delete(String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete Workspace'),
        content: Text('Remove workspace "$id"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Delete', style: TextStyle(color: Colors.red)),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    final cwd = ref.read(selectionProvider).project?.path;
    final bridge = ref.read(bridgeServiceProvider);
    try {
      await bridge.ocRemoveWorkspace(id: id, projectPath: cwd);
      if (!mounted) return;
      await _load();
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Failed to delete workspace: ${humanizeError(e)}');
    }
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);
    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        foregroundColor: oc.text,
        title: Text('Workspaces', style: TextStyle(color: oc.text)),
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
                      if (_workspaces.isEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 24),
                          child: Center(
                            child: Text(
                              'No workspaces found. Sessions use the default project context.',
                              style: TextStyle(color: oc.textMuted),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        )
                      else
                        for (var i = 0; i < _workspaces.length; i++)
                          _WorkspaceCard(
                            ws: _workspaces[i],
                            oc: oc,
                            canDelete: i > 0,
                            onDelete: () =>
                                _delete(_workspaces[i]['id'] as String? ?? ''),
                          ),
                    ],
                  ),
                ),
        ),
      ),
    );
  }
}

class _WorkspaceCard extends StatelessWidget {
  const _WorkspaceCard({
    required this.ws,
    required this.oc,
    required this.canDelete,
    required this.onDelete,
  });

  final Map<String, dynamic> ws;
  final OpenCodeTheme oc;
  final bool canDelete;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final id = ws['id'] as String? ?? 'unknown';
    final parts = <String>[
      if (ws['type'] is String) ws['type'] as String,
      if (ws['branch'] is String) ws['branch'] as String,
    ];
    final subtitle = parts.isEmpty ? 'workspace' : parts.join(' • ');
    return Card(
      color: oc.backgroundPanel,
      child: ListTile(
        leading: Icon(AppIcons.workspace, color: oc.text),
        title: Text(id, style: TextStyle(color: oc.text)),
        subtitle: Text(
          subtitle,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: oc.textMuted),
        ),
        trailing: canDelete
            ? IconButton(
                icon: Icon(AppIcons.delete, color: oc.textMuted),
                tooltip: 'Delete',
                onPressed: onDelete,
              )
            : null,
      ),
    );
  }
}
