import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/worktree.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/app_icons.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../utils/error_utils.dart';
import '../utils/responsive.dart';
import '../widgets/adaptive_container.dart';
import 'package:broski/utils/snackbar_helpers.dart';

/// Screen for managing git worktrees.
///
/// Lists all worktrees, allows creating new ones, and provides
/// reset/delete actions for non-main worktrees.
class OpenCodeWorktreesScreen extends ConsumerStatefulWidget {
  const OpenCodeWorktreesScreen({super.key});

  @override
  ConsumerState<OpenCodeWorktreesScreen> createState() =>
      _OpenCodeWorktreesScreenState();
}

class _OpenCodeWorktreesScreenState
    extends ConsumerState<OpenCodeWorktreesScreen> {
  List<Worktree> _worktrees = const [];
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
      final items = await bridge.listWorktrees(projectPath: cwd);
      if (!mounted) return;
      setState(() {
        _worktrees = items;
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
    final result = await showDialog<({String name, String? startCommand})>(
      context: context,
      builder: (_) => const _CreateWorktreeDialog(),
    );
    if (result == null || !mounted) return;

    final cwd = ref.read(selectionProvider).project?.path;
    final bridge = ref.read(bridgeServiceProvider);
    try {
      await bridge.createWorktree(
        name: result.name,
        startCommand: result.startCommand,
        projectPath: cwd,
      );
      if (mounted) await _load();
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Failed to create worktree: ${humanizeError(e)}');
    }
  }

  Future<void> _reset(Worktree worktree) async {
    final confirmed = await _confirm(
      title: 'Reset Worktree',
      message:
          'Reset "${worktree.displayName}"? This will discard all uncommitted changes in that worktree.',
    );
    if (!confirmed || !mounted) return;

    final cwd = ref.read(selectionProvider).project?.path;
    final bridge = ref.read(bridgeServiceProvider);
    try {
      await bridge.resetWorktree(worktree.directory, projectPath: cwd);
      if (mounted) await _load();
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Failed to reset: ${humanizeError(e)}');
    }
  }

  Future<void> _delete(Worktree worktree) async {
    final confirmed = await _confirm(
      title: 'Delete Worktree',
      message:
          'Delete "${worktree.displayName}"? This will remove the worktree directory and its branch.',
    );
    if (!confirmed || !mounted) return;

    final cwd = ref.read(selectionProvider).project?.path;
    final bridge = ref.read(bridgeServiceProvider);
    try {
      await bridge.deleteWorktree(worktree.name, projectPath: cwd);
      if (mounted) await _load();
    } catch (e) {
      if (!mounted) return;
      showInfo(context, 'Failed to delete: ${humanizeError(e)}');
    }
  }

  Future<bool> _confirm({
    required String title,
    required String message,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final oc = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: oc.background,
      appBar: AppBar(
        backgroundColor: oc.background,
        foregroundColor: oc.text,
        title: Text('Worktrees', style: TextStyle(color: oc.text)),
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
                      if (_worktrees.isEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 24),
                          child: Center(
                            child: Text(
                              'No worktrees found',
                              style: TextStyle(color: oc.textMuted),
                            ),
                          ),
                        )
                      else
                        ..._worktrees.map((w) => _buildCard(w, oc)),
                    ],
                  ),
                ),
        ),
      ),
    );
  }

  Widget _buildCard(Worktree worktree, OpenCodeTheme oc) {
    return Card(
      color: oc.backgroundPanel,
      child: ListTile(
        leading: Icon(AppIcons.gitBranch, color: oc.textMuted),
        title: Text(
          worktree.branch.isNotEmpty ? worktree.branch : worktree.displayName,
          style: TextStyle(color: oc.text),
        ),
        subtitle: Text(
          worktree.directory,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(color: oc.textMuted),
        ),
        trailing: worktree.isMain
            ? Container(
                padding: Insets.chip,
                decoration: BoxDecoration(
                  color: oc.success.withValues(alpha: 0.15),
                  borderRadius: Radii.brSm,
                ),
                child: Text(
                  'current',
                  style: TextStyle(color: oc.success, fontSize: 12),
                ),
              )
            : Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    tooltip: 'Reset',
                    icon: Icon(AppIcons.restart, size: 18, color: oc.textMuted),
                    onPressed: () => _reset(worktree),
                  ),
                  IconButton(
                    tooltip: 'Delete',
                    icon: Icon(AppIcons.delete, size: 18, color: oc.error),
                    onPressed: () => _delete(worktree),
                  ),
                ],
              ),
      ),
    );
  }
}

/// Dialog for creating a new worktree.
class _CreateWorktreeDialog extends StatefulWidget {
  const _CreateWorktreeDialog();

  @override
  State<_CreateWorktreeDialog> createState() => _CreateWorktreeDialogState();
}

class _CreateWorktreeDialogState extends State<_CreateWorktreeDialog> {
  final _nameController = TextEditingController();
  final _commandController = TextEditingController();

  @override
  void dispose() {
    _nameController.dispose();
    _commandController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Create Worktree'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _nameController,
            decoration: const InputDecoration(
              labelText: 'Branch Name',
              hintText: 'feature/my-branch',
            ),
            autofocus: true,
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _commandController,
            decoration: const InputDecoration(
              labelText: 'Start Command (optional)',
              hintText: 'npm run dev',
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        TextButton(
          onPressed: _nameController.text.trim().isEmpty
              ? null
              : () {
                  final cmd = _commandController.text.trim();
                  Navigator.pop(context, (
                    name: _nameController.text.trim(),
                    startCommand: cmd.isEmpty ? null : cmd,
                  ));
                },
          child: const Text('Create'),
        ),
      ],
    );
  }
}
