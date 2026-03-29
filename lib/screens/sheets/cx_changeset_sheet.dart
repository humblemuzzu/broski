import 'package:broski/providers/service_providers.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/snackbar_helpers.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Shows AI change set for a Codex turn with revert capability.
void showCxChangesetSheet({
  required BuildContext context,
  required String threadId,
  String? turnId,
  String? cwd,
}) {
  DetailSheet.show(
    context: context,
    title: 'AI Changes',
    initialSize: 0.7,
    child: _CxChangesetContent(threadId: threadId, turnId: turnId, cwd: cwd),
  );
}

class _CxChangesetContent extends ConsumerStatefulWidget {
  const _CxChangesetContent({required this.threadId, this.turnId, this.cwd});
  final String threadId;
  final String? turnId;
  final String? cwd;

  @override
  ConsumerState<_CxChangesetContent> createState() =>
      _CxChangesetContentState();
}

class _CxChangesetContentState extends ConsumerState<_CxChangesetContent> {
  Map<String, dynamic>? _diffData;
  bool _loading = true;
  bool _reverting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadDiff();
  }

  Future<void> _loadDiff() async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final result = await bridge.cxGetTurnDiff(
        threadId: widget.threadId,
        turnId: widget.turnId,
        cwd: widget.cwd,
      );
      if (mounted) {
        setState(() {
          _diffData = result;
          _loading = false;
          _error = result['error'] as String?;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.toString();
        });
      }
    }
  }

  Future<void> _revertChanges() async {
    final diff = _diffData?['diff'] as String? ?? '';
    if (diff.isEmpty) return;

    setState(() => _reverting = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final result = await bridge.cxRevertChanges(
        threadId: widget.threadId,
        diff: diff,
        cwd: widget.cwd,
      );
      if (!mounted) return;

      final ok = result['ok'] == true;
      if (ok) {
        final files = (result['filesReverted'] as List?)?.length ?? 0;
        showSuccess(context, 'Reverted $files file${files == 1 ? '' : 's'}');
        Navigator.pop(context);
      } else {
        final err = result['error']?.toString() ?? 'Revert failed';
        showError(context, err);
      }
    } catch (e) {
      if (mounted) showError(context, e.toString());
    } finally {
      if (mounted) setState(() => _reverting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    if (_loading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (_error != null && (_diffData == null || _diffData!['diff'] == '')) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'Error loading changes: $_error',
          style: AppTypography.bodySmall(color: theme.error),
        ),
      );
    }

    final files = (_diffData?['files'] as List?)?.cast<String>() ?? [];
    final diff = _diffData?['diff'] as String? ?? '';

    if (files.isEmpty && diff.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          'No uncommitted changes found',
          style: AppTypography.bodySmall(color: theme.textMuted),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // File list header
        Padding(
          padding: Insets.screenH,
          child: Row(
            children: [
              Icon(AppIcons.file, size: 16, color: theme.textMuted),
              const SizedBox(width: 8),
              Text(
                '${files.length} file${files.length == 1 ? '' : 's'} changed',
                style: AppTypography.label(color: theme.text),
              ),
              const Spacer(),
              if (diff.isNotEmpty)
                FilledButton.icon(
                  onPressed: _reverting ? null : _revertChanges,
                  icon: _reverting
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(AppIcons.undo, size: 14),
                  label: Text(_reverting ? 'Reverting...' : 'Revert All'),
                  style: FilledButton.styleFrom(
                    backgroundColor: theme.error,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    textStyle: const TextStyle(fontSize: 12),
                  ),
                ),
            ],
          ),
        ),
        const SizedBox(height: 8),
        // File list
        Expanded(
          child: ListView.separated(
            padding: Insets.screenH,
            itemCount: files.length,
            separatorBuilder: (_, __) =>
                Divider(height: 1, color: theme.border),
            itemBuilder: (context, index) {
              final file = files[index];
              final parts = file.split('/');
              final fileName = parts.last;
              final dir = parts.length > 1
                  ? parts.sublist(0, parts.length - 1).join('/')
                  : '';
              return ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: Icon(AppIcons.file, size: 16, color: theme.warning),
                title: Text(
                  fileName,
                  style: AppTypography.labelSmall(color: theme.text),
                ),
                subtitle: dir.isNotEmpty
                    ? Text(
                        dir,
                        style: AppTypography.codeSmall(color: theme.textMuted),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      )
                    : null,
              );
            },
          ),
        ),
      ],
    );
  }
}
