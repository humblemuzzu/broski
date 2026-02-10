import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/git.dart';
import '../../providers/git_provider.dart';
import '../../providers/service_providers.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../widgets/git/git_diff_inline.dart';
import '../../widgets/git/git_file_tile.dart';
import 'git_branch_sheet.dart';
import 'git_commit_sheet.dart';
import 'git_log_sheet.dart';

class GitPanelSheet extends ConsumerStatefulWidget {
  const GitPanelSheet({super.key, required this.projectPath, this.projectName});

  final String projectPath;
  final String? projectName;

  static Future<void> show({
    required BuildContext context,
    required String projectPath,
    String? projectName,
  }) {
    return DetailSheet.show<void>(
      context: context,
      title: 'Git & GitHub',
      initialSize: 0.9,
      maxSize: 0.98,
      child: GitPanelSheet(projectPath: projectPath, projectName: projectName),
    );
  }

  @override
  ConsumerState<GitPanelSheet> createState() => _GitPanelSheetState();
}

class _GitPanelSheetState extends ConsumerState<GitPanelSheet> {
  final TextEditingController _commitController = TextEditingController();
  GitHubItemState _githubState = GitHubItemState.open;
  bool _busy = false;

  @override
  void dispose() {
    _commitController.dispose();
    super.dispose();
  }

  GitStatusNotifier get _notifier =>
      ref.read(gitStatusProvider(widget.projectPath).notifier);

  void _showError(Object error) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('Error: $error')));
  }

  void _showInfo(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _runAction(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      _showError(e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _viewDiff({required String path, required bool staged}) async {
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final diff = await bridge.gitDiff(
        projectPath: widget.projectPath,
        path: path,
        staged: staged,
      );
      if (!mounted) return;
      await GitDiffInline.show(
        context: context,
        title: '${staged ? 'Staged' : 'Unstaged'} diff • $path',
        diff: diff,
      );
    } catch (e) {
      _showError(e);
    }
  }

  Future<void> _copyIssuePrompt(GitHubIssue issue) async {
    final text =
        'Fix issue #${issue.number}: ${issue.title}\n\n${issue.body ?? ''}';
    await Clipboard.setData(ClipboardData(text: text));
    _showInfo('Issue prompt copied to clipboard');
  }

  Future<void> _copyPrPrompt(GitHubPR pr) async {
    final text =
        'Review PR #${pr.number}: ${pr.title}\n\nHead: ${pr.headBranch}\nBase: ${pr.baseBranch}';
    await Clipboard.setData(ClipboardData(text: text));
    _showInfo('PR prompt copied to clipboard');
  }

  @override
  Widget build(BuildContext context) {
    final statusAsync = ref.watch(gitStatusProvider(widget.projectPath));
    final logAsync = ref.watch(gitLogProvider(widget.projectPath));
    final branchesAsync = ref.watch(gitBranchesProvider(widget.projectPath));
    final remoteAsync = ref.watch(githubRemoteProvider(widget.projectPath));
    final githubRequest = GitHubListRequest(
      projectPath: widget.projectPath,
      state: _githubState,
    );
    final issuesAsync = ref.watch(githubIssuesProvider(githubRequest));
    final prsAsync = ref.watch(githubPrsProvider(githubRequest));

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            widget.projectName ?? widget.projectPath,
            style: Theme.of(context).textTheme.titleSmall,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 10),
          statusAsync.when(
            data: (status) => _buildStatusCard(status),
            loading: () => const LinearProgressIndicator(minHeight: 2),
            error: (error, _) => _buildErrorCard(error),
          ),
          const SizedBox(height: 12),
          _buildActionButtons(statusAsync.hasValue),
          const SizedBox(height: 12),
          if (statusAsync.hasValue) ...[
            _buildChangesSection(statusAsync.value!),
            const SizedBox(height: 12),
          ],
          _buildGitHubSection(
            remoteAsync: remoteAsync,
            issuesAsync: issuesAsync,
            prsAsync: prsAsync,
          ),
          const SizedBox(height: 12),
          _buildHistorySection(logAsync, branchesAsync),
          const SizedBox(height: 14),
        ],
      ),
    );
  }

  Widget _buildStatusCard(GitStatusResult status) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: Theme.of(context).colorScheme.outline.withValues(alpha: 0.25),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Branch: ${status.branch.isEmpty ? '(unknown)' : status.branch}',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 6),
          Text(
            'Upstream: ${status.upstream ?? 'none'}   ↑${status.ahead} ↓${status.behind}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 4),
          Text(
            'Changes: ${status.changedFileCount} (staged ${status.staged.length}, unstaged ${status.unstaged.length}, untracked ${status.untracked.length})',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
      ),
    );
  }

  Widget _buildErrorCard(Object error) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(
          context,
        ).colorScheme.errorContainer.withValues(alpha: 0.25),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text('Git status failed: $error'),
    );
  }

  Widget _buildActionButtons(bool hasStatus) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        FilledButton.icon(
          onPressed: _busy ? null : () => _runAction(() => _notifier.refresh()),
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('Refresh'),
        ),
        OutlinedButton.icon(
          onPressed: _busy || !hasStatus
              ? null
              : () => _runAction(() async {
                  await GitCommitSheet.show(
                    context: context,
                    initialMessage: _commitController.text.trim(),
                    onCommit: (message) async {
                      _commitController.text = message;
                      await _notifier.commit(message);
                      _showInfo('Committed successfully');
                    },
                  );
                }),
          icon: const Icon(Icons.check_rounded),
          label: const Text('Commit'),
        ),
        OutlinedButton(
          onPressed: _busy || !hasStatus
              ? null
              : () => _runAction(() => _notifier.push()),
          child: const Text('Push'),
        ),
        OutlinedButton(
          onPressed: _busy || !hasStatus
              ? null
              : () => _runAction(() => _notifier.pull()),
          child: const Text('Pull'),
        ),
        OutlinedButton(
          onPressed: _busy || !hasStatus
              ? null
              : () => _runAction(() => _notifier.fetch()),
          child: const Text('Fetch'),
        ),
        OutlinedButton(
          onPressed: _busy || !hasStatus
              ? null
              : () => _runAction(() => _notifier.stash()),
          child: const Text('Stash'),
        ),
        OutlinedButton(
          onPressed: _busy || !hasStatus
              ? null
              : () => _runAction(() => _notifier.stashPop()),
          child: const Text('Stash Pop'),
        ),
      ],
    );
  }

  Widget _buildChangesSection(GitStatusResult status) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: Theme.of(context).colorScheme.outline.withValues(alpha: 0.2),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 6),
            child: Row(
              children: [
                const Text(
                  'Changes',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const Spacer(),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => _runAction(() => _notifier.stage()),
                  child: const Text('Stage all'),
                ),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => _runAction(() => _notifier.unstage()),
                  child: const Text('Unstage all'),
                ),
              ],
            ),
          ),
          if (status.staged.isNotEmpty)
            _buildSubsection(
              title: 'Staged (${status.staged.length})',
              children: status.staged
                  .map(
                    (change) => GitFileTile(
                      change: change,
                      isStaged: true,
                      onToggleStage: () => _runAction(
                        () => _notifier.unstage(path: change.path),
                      ),
                      onViewDiff: () =>
                          _viewDiff(path: change.path, staged: true),
                    ),
                  )
                  .toList(),
            ),
          if (status.unstaged.isNotEmpty)
            _buildSubsection(
              title: 'Unstaged (${status.unstaged.length})',
              children: status.unstaged
                  .map(
                    (change) => GitFileTile(
                      change: change,
                      isStaged: false,
                      onToggleStage: () =>
                          _runAction(() => _notifier.stage(path: change.path)),
                      onViewDiff: () =>
                          _viewDiff(path: change.path, staged: false),
                      onRevert: () =>
                          _runAction(() => _notifier.revertFile(change.path)),
                    ),
                  )
                  .toList(),
            ),
          if (status.untracked.isNotEmpty)
            _buildSubsection(
              title: 'Untracked (${status.untracked.length})',
              children: status.untracked
                  .map(
                    (path) => ListTile(
                      dense: true,
                      title: Text(
                        path,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: TextButton(
                        onPressed: _busy
                            ? null
                            : () =>
                                  _runAction(() => _notifier.stage(path: path)),
                        child: const Text('Stage'),
                      ),
                    ),
                  )
                  .toList(),
            ),
          if (status.changedFileCount == 0)
            const Padding(
              padding: EdgeInsets.all(12),
              child: Text('Working tree clean ✅'),
            ),
        ],
      ),
    );
  }

  Widget _buildSubsection({
    required String title,
    required List<Widget> children,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 6, 12, 4),
            child: Text(title, style: Theme.of(context).textTheme.labelMedium),
          ),
          ...children,
        ],
      ),
    );
  }

  Widget _buildGitHubSection({
    required AsyncValue<GitHubRemote?> remoteAsync,
    required AsyncValue<List<GitHubIssue>> issuesAsync,
    required AsyncValue<List<GitHubPR>> prsAsync,
  }) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: Theme.of(context).colorScheme.outline.withValues(alpha: 0.2),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text(
                  'GitHub',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const Spacer(),
                DropdownButton<GitHubItemState>(
                  value: _githubState,
                  underline: const SizedBox.shrink(),
                  items: GitHubItemState.values
                      .map(
                        (state) => DropdownMenuItem(
                          value: state,
                          child: Text(state.displayName),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value == null) return;
                    setState(() => _githubState = value);
                  },
                ),
              ],
            ),
            const SizedBox(height: 8),
            remoteAsync.when(
              data: (remote) => Text(
                remote == null
                    ? 'No GitHub remote detected.'
                    : '${remote.host}/${remote.owner}/${remote.repo}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              loading: () => const Text('Detecting remote…'),
              error: (error, _) => Text('Remote error: $error'),
            ),
            const SizedBox(height: 8),
            const Text('Issues', style: TextStyle(fontWeight: FontWeight.w600)),
            issuesAsync.when(
              data: (issues) {
                if (issues.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.only(top: 4, bottom: 8),
                    child: Text('No issues'),
                  );
                }
                return Column(
                  children: issues.take(5).map((issue) {
                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        '#${issue.number} ${issue.title}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text(issue.author),
                      trailing: IconButton(
                        tooltip: 'Copy prompt',
                        onPressed: () => _copyIssuePrompt(issue),
                        icon: const Icon(Icons.copy_rounded, size: 18),
                      ),
                    );
                  }).toList(),
                );
              },
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: LinearProgressIndicator(minHeight: 2),
              ),
              error: (error, _) => Text('Issue load failed: $error'),
            ),
            const SizedBox(height: 6),
            const Text(
              'Pull Requests',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            prsAsync.when(
              data: (prs) {
                if (prs.isEmpty) {
                  return const Padding(
                    padding: EdgeInsets.only(top: 4),
                    child: Text('No pull requests'),
                  );
                }
                return Column(
                  children: prs.take(5).map((pr) {
                    return ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(
                        '#${pr.number} ${pr.title}',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      subtitle: Text('${pr.headBranch} → ${pr.baseBranch}'),
                      trailing: IconButton(
                        tooltip: 'Copy prompt',
                        onPressed: () => _copyPrPrompt(pr),
                        icon: const Icon(Icons.copy_rounded, size: 18),
                      ),
                    );
                  }).toList(),
                );
              },
              loading: () => const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: LinearProgressIndicator(minHeight: 2),
              ),
              error: (error, _) => Text('PR load failed: $error'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHistorySection(
    AsyncValue<List<GitLogEntry>> logAsync,
    AsyncValue<List<GitBranch>> branchesAsync,
  ) {
    return Row(
      children: [
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _busy
                ? null
                : () async {
                    final logs = logAsync.valueOrNull;
                    if (logs == null) {
                      _showInfo('Commit log is still loading');
                      return;
                    }
                    await GitLogSheet.show(
                      context: context,
                      entries: logs,
                      onLoadDiff: (hash) => ref
                          .read(bridgeServiceProvider)
                          .gitCommitDiff(
                            projectPath: widget.projectPath,
                            hash: hash,
                          ),
                    );
                  },
            icon: const Icon(Icons.history_rounded),
            label: const Text('Commits'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: OutlinedButton.icon(
            onPressed: _busy
                ? null
                : () async {
                    final branches = branchesAsync.valueOrNull;
                    if (branches == null) {
                      _showInfo('Branches are still loading');
                      return;
                    }
                    await GitBranchSheet.show(
                      context: context,
                      branches: branches,
                      onCheckout: (branch) =>
                          _runAction(() => _notifier.checkout(branch)),
                      onCreateBranch: (name) =>
                          _runAction(() => _notifier.createBranch(name)),
                    );
                  },
            icon: const Icon(Icons.call_split_rounded),
            label: const Text('Branches'),
          ),
        ),
      ],
    );
  }
}
