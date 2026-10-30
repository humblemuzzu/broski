import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/ui/panels/tree/tree_actions.dart';
import 'package:broski/agent/ui/panels/tree/tree_model.dart';
import 'package:broski/agent/ui/panels/tree/tree_row_tile.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The most nodes the sheet holds. A bigger tree shows its newest entries and
/// says how many it leaves out.
const treeLoadCap = 1000;

const _pageLimit = 200;

/// A session's tree (contract §13, `read_tree`): every branch, the label of
/// each node and the position the session is at, with the ways to move it
/// (`navigate_tree`, optionally summarising the branch left; cancellable) and
/// to label a node.
Future<void> showTreeSheet(BuildContext context, SessionRef session) =>
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.9,
        maxChildSize: 0.95,
        builder: (_, scroll) => TreePanel(session: session, scroll: scroll),
      ),
    );

class TreePanel extends ConsumerStatefulWidget {
  const TreePanel({super.key, required this.session, required this.scroll});

  final SessionRef session;
  final ScrollController scroll;

  @override
  ConsumerState<TreePanel> createState() => _TreePanelState();
}

class _TreePanelState extends ConsumerState<TreePanel> {
  var _nodes = <TreeNode>[];
  String? _leafId;
  var _total = 0;
  String? _next;
  var _loading = true;
  String? _problem;
  var _filter = TreeFilter.standard;
  _Working _working = _Working.nothing;

  PiCall _call(PiOp op) => PiCall(op: op);

  @override
  void initState() {
    super.initState();
    _read(fresh: true);
  }

  Future<void> _read({required bool fresh}) async {
    setState(() {
      _loading = true;
      _problem = null;
    });
    final outcome = await ref
        .read(contractClientProvider)
        .callBackend(
          _call(
            ReadTreeOp(
              sessionId: widget.session.sessionId,
              page: PageRequest(
                limit: _pageLimit,
                cursor: fresh ? null : _next,
              ),
            ),
          ),
        );
    if (!mounted) return;
    setState(() {
      _loading = false;
      switch (outcome) {
        case Done(value: final TreeRead read):
          _nodes = fresh ? read.nodes : [..._nodes, ...read.nodes];
          _leafId = read.leafId;
          _total = read.total;
          _next = _nodes.length >= treeLoadCap ? null : read.nextCursor;
        case Done():
          _problem = 'The Mac answered with something else than a tree.';
        case Refused() || Unreached():
          _problem = problemOf(outcome);
      }
    });
  }

  Future<void> _tapped(TreeNode node) async {
    final action = await chooseTreeAction(
      context,
      node,
      isLeaf: node.id == _leafId,
    );
    if (action == null || !mounted) return;
    switch (action) {
      case TreeContinue():
        await _continue(node, action);
      case TreeLabel(:final label):
        await _label(node, label);
    }
  }

  Future<void> _continue(TreeNode node, TreeContinue choice) async {
    final client = ref.read(contractClientProvider);
    setState(
      () =>
          _working = choice.summarize ? _Working.summarising : _Working.moving,
    );
    final outcome = await client.callBackend(
      _call(
        NavigateTreeOp(
          sessionId: widget.session.sessionId,
          itemId: node.itemId,
          summarize: choice.summarize,
          instructions: choice.instructions,
        ),
      ),
    );
    if (!mounted) return;
    final cancelled = _working == _Working.cancelling;
    setState(() => _working = _Working.nothing);
    if (outcome is Done) {
      if (node.kind == TreeNodeKind.user && !node.previewCut) {
        ref
            .read(sessionProvider(widget.session).notifier)
            .controls
            .returnInput(node.preview);
      }
      Navigator.of(context).pop();
      return;
    }
    if (!cancelled) showProblem(context, problemOf(outcome));
    await _read(fresh: true);
  }

  Future<void> _cancelSummary() async {
    setState(() => _working = _Working.cancelling);
    final outcome = await ref
        .read(contractClientProvider)
        .callBackend(
          _call(AbortBranchSummaryOp(sessionId: widget.session.sessionId)),
        );
    if (mounted) showProblem(context, problemOf(outcome));
  }

  Future<void> _label(TreeNode node, String? label) async {
    final outcome = await ref
        .read(contractClientProvider)
        .callBackend(
          _call(
            LabelEntryOp(
              sessionId: widget.session.sessionId,
              entryId: node.id,
              label: label,
            ),
          ),
        );
    if (!mounted) return;
    showProblem(context, problemOf(outcome));
    if (outcome is Done) await _read(fresh: true);
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final rows = treeRows(_nodes, _leafId, _filter);
    return Column(
      key: const ValueKey('tree-panel'),
      children: [
        _header(theme, rows.length),
        if (_working != _Working.nothing) _workingBar(theme),
        Expanded(
          child: _nodes.isEmpty && !_loading
              ? Center(
                  child: Text(
                    _problem ?? 'Nothing in this session yet.',
                    style: AppTypography.bodySmall(color: theme.textMuted),
                  ),
                )
              : ListView.builder(
                  controller: widget.scroll,
                  itemCount: rows.length + 1,
                  itemBuilder: (context, index) => index == rows.length
                      ? _footer(theme)
                      : TreeRowTile(
                          row: rows[index],
                          onTap: _working == _Working.nothing
                              ? () => _tapped(rows[index].node)
                              : null,
                        ),
                ),
        ),
      ],
    );
  }

  Widget _header(OpenCodeTheme theme, int shown) => Padding(
    padding: Insets.cardSm,
    child: Row(
      children: [
        Expanded(child: Text('Session tree', style: AppTypography.h3())),
        PopupMenuButton<TreeFilter>(
          key: const ValueKey('tree-filter'),
          tooltip: 'Show',
          icon: const Icon(AppIcons.filter),
          initialValue: _filter,
          onSelected: (filter) => setState(() => _filter = filter),
          itemBuilder: (_) => [
            for (final filter in TreeFilter.values)
              PopupMenuItem(value: filter, child: Text(filter.label)),
          ],
        ),
        IconButton(
          key: const ValueKey('tree-refresh'),
          tooltip: 'Read again',
          icon: const Icon(AppIcons.refresh),
          onPressed: _loading ? null : () => _read(fresh: true),
        ),
      ],
    ),
  );

  Widget _workingBar(OpenCodeTheme theme) => Padding(
    key: const ValueKey('tree-working'),
    padding: Insets.chipH,
    child: Row(
      children: [
        const SizedBox.square(
          dimension: 14,
          child: CircularProgressIndicator(strokeWidth: 1.5),
        ),
        const SizedBox(width: Spacing.sm),
        Expanded(
          child: Text(switch (_working) {
            _Working.summarising => 'Summarising the branch you leave…',
            _Working.cancelling => 'Cancelling…',
            _ => 'Moving…',
          }, style: AppTypography.label(color: theme.primary)),
        ),
        if (_working == _Working.summarising)
          TextButton(
            key: const ValueKey('tree-cancel-summary'),
            onPressed: _cancelSummary,
            child: const Text('Cancel'),
          ),
      ],
    ),
  );

  Widget _footer(OpenCodeTheme theme) {
    if (_loading) {
      return const Padding(
        padding: Insets.screen,
        child: Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }
    final left = _total - _nodes.length;
    return Padding(
      padding: Insets.screen,
      child: Column(
        children: [
          if (_problem != null)
            Text(_problem!, style: AppTypography.bodySmall(color: theme.error)),
          if (_next != null)
            TextButton(
              key: const ValueKey('tree-more'),
              onPressed: () => _read(fresh: false),
              child: Text('Load earlier entries ($left more)'),
            )
          else if (left > 0)
            Text(
              'Showing the newest ${_nodes.length} of $_total entries. '
              'Open the session in a terminal to see the rest.',
              key: const ValueKey('tree-capped'),
              style: AppTypography.caption(color: theme.textMuted),
            ),
        ],
      ),
    );
  }
}

enum _Working { nothing, moving, summarising, cancelling }
