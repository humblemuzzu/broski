import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../models/git.dart';
import '../../providers/git_provider.dart';
import '../../providers/service_providers.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import '../../widgets/git/git_diff_inline.dart';
import '../../widgets/git/git_file_tile.dart';
import 'git_commit_sheet.dart';

class GitPanelSheet extends ConsumerStatefulWidget {
  const GitPanelSheet({
    super.key,
    required this.projectPath,
    this.projectName,
    required this.scrollController,
  });

  final String projectPath;
  final String? projectName;
  final ScrollController scrollController;

  static Future<void> show({
    required BuildContext context,
    required String projectPath,
    String? projectName,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: 0.9,
        maxChildSize: 0.98,
        minChildSize: 0.25,
        expand: false,
        builder: (context, scrollController) {
          return GitPanelSheet(
            projectPath: projectPath,
            projectName: projectName,
            scrollController: scrollController,
          );
        },
      ),
    );
  }

  @override
  ConsumerState<GitPanelSheet> createState() => _GitPanelSheetState();
}

class _GitPanelSheetState extends ConsumerState<GitPanelSheet> {
  int _selectedTab = 0;
  GitHubItemState _githubState = GitHubItemState.open;
  bool _busy = false;
  final _branchController = TextEditingController();
  bool _creatingBranch = false;

  @override
  void dispose() {
    _branchController.dispose();
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

  String _formatTimestamp(DateTime timestamp) {
    final local = timestamp.toLocal();
    final month = local.month.toString().padLeft(2, '0');
    final day = local.day.toString().padLeft(2, '0');
    final hour = local.hour.toString().padLeft(2, '0');
    final minute = local.minute.toString().padLeft(2, '0');
    return '${local.year}-$month-$day $hour:$minute';
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
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

    return Container(
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        children: [
          // Drag handle
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 8),
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: theme.textMuted.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Stack(
              alignment: Alignment.center,
              children: [
                Text(
                  'Git & GitHub',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Align(
                  alignment: Alignment.centerLeft,
                  child: IconButton(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: Icon(Icons.close, color: theme.textMuted, size: 24),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ),
                Align(
                  alignment: Alignment.centerRight,
                  child: IconButton(
                    onPressed: _busy
                        ? null
                        : () => _runAction(() => _notifier.refresh()),
                    icon: Icon(
                      Icons.refresh_rounded,
                      color: _busy
                          ? theme.textMuted.withValues(alpha: 0.4)
                          : theme.textMuted,
                      size: 22,
                    ),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                  ),
                ),
              ],
            ),
          ),

          // Segmented tab bar
          _buildSegmentedBar(theme),

          Divider(height: 1, color: theme.borderSubtle),

          // Tab content
          Expanded(
            child: SingleChildScrollView(
              controller: widget.scrollController,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              child: _buildTabContent(
                theme: theme,
                statusAsync: statusAsync,
                logAsync: logAsync,
                branchesAsync: branchesAsync,
                remoteAsync: remoteAsync,
                issuesAsync: issuesAsync,
                prsAsync: prsAsync,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Segmented bar
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildSegmentedBar(OpenCodeTheme theme) {
    const labels = ['Changes', 'GitHub', 'History'];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      child: Container(
        padding: const EdgeInsets.all(3),
        decoration: BoxDecoration(
          color: theme.backgroundElement,
          borderRadius: Radii.brMd,
        ),
        child: Row(
          children: List.generate(3, (i) {
            final selected = _selectedTab == i;
            return Expanded(
              child: GestureDetector(
                onTap: () => setState(() => _selectedTab = i),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    color: selected ? theme.primary : Colors.transparent,
                    borderRadius: BorderRadius.circular(9),
                  ),
                  child: Text(
                    labels[i],
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: selected
                          ? theme.selectedListItemText
                          : theme.textMuted,
                    ),
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Tab content router
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildTabContent({
    required OpenCodeTheme theme,
    required AsyncValue<GitStatusResult> statusAsync,
    required AsyncValue<List<GitLogEntry>> logAsync,
    required AsyncValue<List<GitBranch>> branchesAsync,
    required AsyncValue<GitHubRemote?> remoteAsync,
    required AsyncValue<List<GitHubIssue>> issuesAsync,
    required AsyncValue<List<GitHubPR>> prsAsync,
  }) {
    switch (_selectedTab) {
      case 0:
        return _buildChangesTab(theme, statusAsync);
      case 1:
        return _buildGitHubTab(theme, remoteAsync, issuesAsync, prsAsync);
      case 2:
        return _buildHistoryTab(theme, logAsync, branchesAsync);
      default:
        return const SizedBox.shrink();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Changes tab
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildChangesTab(
    OpenCodeTheme theme,
    AsyncValue<GitStatusResult> statusAsync,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Status card
        statusAsync.when(
          data: (status) => _buildStatusCard(theme, status),
          loading: () => const LinearProgressIndicator(minHeight: 2),
          error: (error, _) => _buildErrorCard(theme, error),
        ),
        const SizedBox(height: 12),

        // Primary action buttons
        _buildPrimaryActions(theme, statusAsync.hasValue),
        const SizedBox(height: 2),

        // Secondary action buttons
        _buildSecondaryActions(theme, statusAsync.hasValue),
        const SizedBox(height: 12),

        // File changes
        if (statusAsync.hasValue)
          _buildChangesSection(theme, statusAsync.value!),
        const SizedBox(height: 14),
      ],
    );
  }

  Widget _buildStatusCard(OpenCodeTheme theme, GitStatusResult status) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.backgroundElement,
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.call_split_rounded, size: 16, color: theme.primary),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  status.branch.isEmpty ? '(unknown)' : status.branch,
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: theme.text,
                    fontSize: 14,
                  ),
                ),
              ),
              if (status.ahead > 0)
                Padding(
                  padding: const EdgeInsets.only(right: 6),
                  child: Text(
                    '↑${status.ahead}',
                    style: TextStyle(
                      color: theme.success,
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                    ),
                  ),
                ),
              if (status.behind > 0)
                Text(
                  '↓${status.behind}',
                  style: TextStyle(
                    color: theme.warning,
                    fontWeight: FontWeight.w600,
                    fontSize: 13,
                  ),
                ),
            ],
          ),
          if (status.upstream != null) ...[
            const SizedBox(height: 4),
            Text(
              status.upstream!,
              style: TextStyle(color: theme.textMuted, fontSize: 12),
            ),
          ],
          const SizedBox(height: 6),
          Text(
            '${status.staged.length} staged · ${status.unstaged.length} unstaged · ${status.untracked.length} untracked',
            style: TextStyle(color: theme.textMuted, fontSize: 12),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorCard(OpenCodeTheme theme, Object error) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.error.withValues(alpha: 0.1),
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.error.withValues(alpha: 0.3)),
      ),
      child: Text(
        'Git status failed: $error',
        style: TextStyle(color: theme.error, fontSize: 13),
      ),
    );
  }

  Widget _buildPrimaryActions(OpenCodeTheme theme, bool hasStatus) {
    return Row(
      children: [
        Expanded(
          flex: 2,
          child: FilledButton.icon(
            onPressed: _busy || !hasStatus
                ? null
                : () async {
                    await GitCommitSheet.show(
                      context: context,
                      onCommit: (message) async {
                        await _notifier.commit(message);
                        _showInfo('Committed successfully');
                      },
                    );
                  },
            icon: const Icon(Icons.check_rounded, size: 18),
            label: const Text('Commit'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: OutlinedButton(
            onPressed: _busy || !hasStatus
                ? null
                : () => _runAction(() => _notifier.push()),
            child: const Text('Push ↑'),
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: OutlinedButton(
            onPressed: _busy || !hasStatus
                ? null
                : () => _runAction(() => _notifier.pull()),
            child: const Text('Pull ↓'),
          ),
        ),
      ],
    );
  }

  Widget _buildSecondaryActions(OpenCodeTheme theme, bool hasStatus) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _secondaryButton(
          label: 'Fetch',
          onPressed:
              hasStatus ? () => _runAction(() => _notifier.fetch()) : null,
          theme: theme,
        ),
        _secondaryButton(
          label: 'Stash',
          onPressed:
              hasStatus ? () => _runAction(() => _notifier.stash()) : null,
          theme: theme,
        ),
        _secondaryButton(
          label: 'Stash Pop',
          onPressed:
              hasStatus ? () => _runAction(() => _notifier.stashPop()) : null,
          theme: theme,
        ),
      ],
    );
  }

  Widget _secondaryButton({
    required String label,
    required VoidCallback? onPressed,
    required OpenCodeTheme theme,
  }) {
    return TextButton(
      onPressed: _busy ? null : onPressed,
      style: TextButton.styleFrom(
        foregroundColor: theme.textMuted,
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
      ),
      child: Text(label),
    );
  }

  Widget _buildChangesSection(OpenCodeTheme theme, GitStatusResult status) {
    return Container(
      decoration: BoxDecoration(
        borderRadius: Radii.brMd,
        border: Border.all(color: theme.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Staged
          if (status.staged.isNotEmpty)
            _buildFileSubsection(
              theme: theme,
              title: 'Staged (${status.staged.length})',
              trailing: TextButton(
                onPressed: _busy
                    ? null
                    : () => _runAction(() => _notifier.unstage()),
                style: TextButton.styleFrom(
                  textStyle: const TextStyle(fontSize: 12),
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Unstage all'),
              ),
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

          // Unstaged
          if (status.unstaged.isNotEmpty)
            _buildFileSubsection(
              theme: theme,
              title: 'Unstaged (${status.unstaged.length})',
              trailing: TextButton(
                onPressed: _busy
                    ? null
                    : () => _runAction(() => _notifier.stage()),
                style: TextButton.styleFrom(
                  textStyle: const TextStyle(fontSize: 12),
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Stage all'),
              ),
              children: status.unstaged
                  .map(
                    (change) => GitFileTile(
                      change: change,
                      isStaged: false,
                      onToggleStage: () => _runAction(
                        () => _notifier.stage(path: change.path),
                      ),
                      onViewDiff: () =>
                          _viewDiff(path: change.path, staged: false),
                      onRevert: () =>
                          _runAction(() => _notifier.revertFile(change.path)),
                    ),
                  )
                  .toList(),
            ),

          // Untracked
          if (status.untracked.isNotEmpty)
            _buildFileSubsection(
              theme: theme,
              title: 'Untracked (${status.untracked.length})',
              trailing: TextButton(
                onPressed: _busy
                    ? null
                    : () => _runAction(() => _notifier.stage()),
                style: TextButton.styleFrom(
                  textStyle: const TextStyle(fontSize: 12),
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: Size.zero,
                  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                ),
                child: const Text('Stage all'),
              ),
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
                            : () => _runAction(
                                  () => _notifier.stage(path: path),
                                ),
                        child: const Text('Stage'),
                      ),
                    ),
                  )
                  .toList(),
            ),

          // Clean state
          if (status.changedFileCount == 0)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Center(
                child: Text(
                  'Working tree clean',
                  style: TextStyle(color: theme.success, fontSize: 13),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildFileSubsection({
    required OpenCodeTheme theme,
    required String title,
    Widget? trailing,
    required List<Widget> children,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 4, 4),
          child: Row(
            children: [
              Text(
                title,
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  fontSize: 12,
                  color: theme.textMuted,
                ),
              ),
              const Spacer(),
              if (trailing != null) trailing,
            ],
          ),
        ),
        ...children,
      ],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GitHub tab
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildGitHubTab(
    OpenCodeTheme theme,
    AsyncValue<GitHubRemote?> remoteAsync,
    AsyncValue<List<GitHubIssue>> issuesAsync,
    AsyncValue<List<GitHubPR>> prsAsync,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Remote info
        remoteAsync.when(
          data: (remote) => remote == null
              ? Text(
                  'No GitHub remote detected.',
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
                )
              : Row(
                  children: [
                    Icon(
                      Icons.cloud_outlined,
                      size: 16,
                      color: theme.textMuted,
                    ),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        '${remote.host}/${remote.owner}/${remote.repo}',
                        style:
                            TextStyle(color: theme.textMuted, fontSize: 13),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
          loading: () => Text(
            'Detecting remote...',
            style: TextStyle(color: theme.textMuted, fontSize: 13),
          ),
          error: (error, _) => Text(
            'Remote error: $error',
            style: TextStyle(color: theme.error, fontSize: 13),
          ),
        ),
        const SizedBox(height: 10),

        // Filter dropdown
        Row(
          children: [
            Text(
              'Filter:',
              style: TextStyle(color: theme.textMuted, fontSize: 13),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              decoration: BoxDecoration(
                border: Border.all(color: theme.borderSubtle),
                borderRadius: Radii.brSm,
              ),
              child: DropdownButton<GitHubItemState>(
                value: _githubState,
                underline: const SizedBox.shrink(),
                isDense: true,
                style: TextStyle(color: theme.text, fontSize: 13),
                dropdownColor: theme.backgroundMenu,
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
            ),
          ],
        ),
        const SizedBox(height: 14),

        // Issues
        _buildGitHubListSection<GitHubIssue>(
          theme: theme,
          title: 'Issues',
          asyncData: issuesAsync,
          emptyLabel: 'No issues',
          itemBuilder: (issue) => ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text(
              '#${issue.number} ${issue.title}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: theme.text, fontSize: 14),
            ),
            subtitle: Text(
              issue.author,
              style: TextStyle(color: theme.textMuted, fontSize: 12),
            ),
            trailing: IconButton(
              tooltip: 'Copy prompt',
              onPressed: () => _copyIssuePrompt(issue),
              icon: Icon(Icons.copy_rounded, size: 16, color: theme.textMuted),
            ),
          ),
        ),
        const SizedBox(height: 14),

        // PRs
        _buildGitHubListSection<GitHubPR>(
          theme: theme,
          title: 'Pull Requests',
          asyncData: prsAsync,
          emptyLabel: 'No pull requests',
          itemBuilder: (pr) => ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text(
              '#${pr.number} ${pr.title}',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(color: theme.text, fontSize: 14),
            ),
            subtitle: Text(
              '${pr.headBranch} → ${pr.baseBranch}',
              style: TextStyle(color: theme.textMuted, fontSize: 12),
            ),
            trailing: IconButton(
              tooltip: 'Copy prompt',
              onPressed: () => _copyPrPrompt(pr),
              icon: Icon(Icons.copy_rounded, size: 16, color: theme.textMuted),
            ),
          ),
        ),
        const SizedBox(height: 14),
      ],
    );
  }

  Widget _buildGitHubListSection<T>({
    required OpenCodeTheme theme,
    required String title,
    required AsyncValue<List<T>> asyncData,
    required String emptyLabel,
    required Widget Function(T item) itemBuilder,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: theme.text,
            fontSize: 14,
          ),
        ),
        const SizedBox(height: 4),
        asyncData.when(
          data: (items) {
            if (items.isEmpty) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  emptyLabel,
                  style: TextStyle(color: theme.textMuted, fontSize: 13),
                ),
              );
            }
            return Column(
              children: items.take(5).map(itemBuilder).toList(),
            );
          },
          loading: () => const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: LinearProgressIndicator(minHeight: 2),
          ),
          error: (error, _) => Text(
            'Load failed: $error',
            style: TextStyle(color: theme.error, fontSize: 13),
          ),
        ),
      ],
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // History tab
  // ═══════════════════════════════════════════════════════════════════════════

  Widget _buildHistoryTab(
    OpenCodeTheme theme,
    AsyncValue<List<GitLogEntry>> logAsync,
    AsyncValue<List<GitBranch>> branchesAsync,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // New branch input
        _buildNewBranchRow(theme),
        const SizedBox(height: 14),

        // Recent commits
        Text(
          'Recent Commits',
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: theme.text,
            fontSize: 14,
          ),
        ),
        const SizedBox(height: 6),
        _buildCommitsList(theme, logAsync),
        const SizedBox(height: 14),

        // Local branches
        Text(
          'Local Branches',
          style: TextStyle(
            fontWeight: FontWeight.w600,
            color: theme.text,
            fontSize: 14,
          ),
        ),
        const SizedBox(height: 6),
        _buildBranchesList(theme, branchesAsync),
        const SizedBox(height: 14),
      ],
    );
  }

  Widget _buildNewBranchRow(OpenCodeTheme theme) {
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: _branchController,
            style: TextStyle(color: theme.text, fontSize: 14),
            decoration: InputDecoration(
              hintText: 'New branch name',
              hintStyle: TextStyle(color: theme.textMuted),
              isDense: true,
              filled: true,
              fillColor: theme.backgroundElement,
              border: OutlineInputBorder(
                borderRadius: Radii.brSm,
                borderSide: BorderSide.none,
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: Radii.brSm,
                borderSide: BorderSide(color: theme.borderSubtle),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: Radii.brSm,
                borderSide: BorderSide(color: theme.primary, width: 1.5),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 10,
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        FilledButton(
          onPressed: _creatingBranch
              ? null
              : () async {
                  final name = _branchController.text.trim();
                  if (name.isEmpty) return;
                  setState(() => _creatingBranch = true);
                  try {
                    await _notifier.createBranch(name);
                    _branchController.clear();
                    _showInfo('Branch "$name" created');
                  } catch (e) {
                    _showError(e);
                  } finally {
                    if (mounted) setState(() => _creatingBranch = false);
                  }
                },
          child: Text(_creatingBranch ? 'Creating...' : 'Create'),
        ),
      ],
    );
  }

  Widget _buildCommitsList(
    OpenCodeTheme theme,
    AsyncValue<List<GitLogEntry>> logAsync,
  ) {
    return logAsync.when(
      data: (entries) {
        if (entries.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'No commits yet.',
              style: TextStyle(color: theme.textMuted, fontSize: 13),
            ),
          );
        }
        return Container(
          decoration: BoxDecoration(
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Column(
            children: entries.take(15).map((entry) {
              return ListTile(
                dense: true,
                leading: Text(
                  entry.shortHash,
                  style: TextStyle(
                    fontFamily: GoogleFonts.jetBrainsMono().fontFamily,
                    fontSize: 12,
                    color: theme.primary,
                  ),
                ),
                title: Text(
                  entry.subject.isEmpty ? '(no subject)' : entry.subject,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.text, fontSize: 13),
                ),
                subtitle: Text(
                  '${entry.author} · ${_formatTimestamp(entry.timestamp)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.textMuted, fontSize: 11),
                ),
                onTap: () async {
                  try {
                    final diff = await ref
                        .read(bridgeServiceProvider)
                        .gitCommitDiff(
                          projectPath: widget.projectPath,
                          hash: entry.hash,
                        );
                    if (!mounted) return;
                    await GitDiffInline.show(
                      context: context,
                      title: 'Commit ${entry.shortHash}',
                      diff: diff,
                    );
                  } catch (e) {
                    _showError(e);
                  }
                },
              );
            }).toList(),
          ),
        );
      },
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: LinearProgressIndicator(minHeight: 2),
      ),
      error: (error, _) => Text(
        'Failed to load commits: $error',
        style: TextStyle(color: theme.error, fontSize: 13),
      ),
    );
  }

  Widget _buildBranchesList(
    OpenCodeTheme theme,
    AsyncValue<List<GitBranch>> branchesAsync,
  ) {
    return branchesAsync.when(
      data: (branches) {
        final local = branches.where((b) => !b.isRemote).toList();
        if (local.isEmpty) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              'No local branches.',
              style: TextStyle(color: theme.textMuted, fontSize: 13),
            ),
          );
        }
        return Container(
          decoration: BoxDecoration(
            borderRadius: Radii.brMd,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Column(
            children: local.map((branch) {
              return ListTile(
                dense: true,
                leading: Icon(
                  branch.isCurrent
                      ? Icons.check_circle_rounded
                      : Icons.circle_outlined,
                  size: 18,
                  color: branch.isCurrent ? theme.primary : theme.textMuted,
                ),
                title: Text(
                  branch.name,
                  style: TextStyle(
                    color: theme.text,
                    fontSize: 13,
                    fontWeight:
                        branch.isCurrent ? FontWeight.w600 : FontWeight.normal,
                  ),
                ),
                subtitle: branch.tracking != null
                    ? Text(
                        branch.tracking!,
                        style:
                            TextStyle(color: theme.textMuted, fontSize: 11),
                      )
                    : null,
                onTap: branch.isCurrent
                    ? null
                    : () =>
                        _runAction(() => _notifier.checkout(branch.name)),
              );
            }).toList(),
          ),
        );
      },
      loading: () => const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: LinearProgressIndicator(minHeight: 2),
      ),
      error: (error, _) => Text(
        'Failed to load branches: $error',
        style: TextStyle(color: theme.error, fontSize: 13),
      ),
    );
  }
}
