import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/op_call.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/tree/tree_actions.dart';
import 'package:broski/screens/agent/panels/tree/tree_model.dart';
import 'package:broski/screens/agent/panels/tree/tree_panel_footer.dart';
import 'package:broski/screens/agent/panels/tree/tree_panel_header.dart';
import 'package:broski/screens/agent/panels/tree/tree_row_tile.dart';
import 'package:broski/screens/agent/panels/tree/tree_working_bar.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
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
    DetailSheet.showScrolling<void>(
      context: context,
      title: 'Session tree',
      initialSize: 0.9,
      maxSize: 0.95,
      builder: (scroll) => TreePanel(session: session, scroll: scroll),
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
          opCall(
            widget.session,
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
      opCall(
        widget.session,
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
          opCall(
            widget.session,
            AbortBranchSummaryOp(sessionId: widget.session.sessionId),
          ),
        );
    if (mounted) showProblem(context, problemOf(outcome));
  }

  Future<void> _label(TreeNode node, String? label) async {
    final outcome = await ref
        .read(contractClientProvider)
        .callBackend(
          opCall(
            widget.session,
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
    final rows = treeRows(_nodes, _leafId, _filter);
    return Column(
      key: const ValueKey('tree-panel'),
      children: [
        TreePanelHeader(
          filter: _filter,
          shown: rows.length,
          total: _total,
          loading: _loading,
          onFilter: (filter) => setState(() => _filter = filter),
          onRefresh: () => _read(fresh: true),
        ),
        if (_working != _Working.nothing)
          TreeWorkingBar(
            label: switch (_working) {
              _Working.summarising => 'Summarising the branch you leave…',
              _Working.cancelling => 'Cancelling…',
              _ => 'Moving…',
            },
            onCancel: _working == _Working.summarising ? _cancelSummary : null,
          ),
        Expanded(child: _body(context, rows)),
      ],
    );
  }

  Widget _body(BuildContext context, List<TreeRow> rows) {
    if (_nodes.isEmpty && !_loading) {
      return _NothingToShow(
        problem: _problem,
        theme: OpenCodeTheme.of(context),
      );
    }
    return ListView.builder(
      controller: widget.scroll,
      itemCount: rows.length + 1,
      itemBuilder: (context, index) => index == rows.length
          ? TreePanelFooter(
              loading: _loading,
              problem: _problem,
              left: _total - _nodes.length,
              more: _next != null,
              shown: _nodes.length,
              total: _total,
              onMore: () => _read(fresh: false),
            )
          : TreeRowTile(
              row: rows[index],
              onTap: _working == _Working.nothing
                  ? () => _tapped(rows[index].node)
                  : null,
            ),
    );
  }
}

/// The sheet of a session too young to hold a tree, or of a tree that could
/// not be read.
class _NothingToShow extends StatelessWidget {
  const _NothingToShow({required this.problem, required this.theme});

  final String? problem;
  final OpenCodeTheme theme;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: Insets.screen,
      child: Text(
        problem ?? 'Nothing in this session yet.',
        textAlign: TextAlign.center,
        style: AppTypography.bodySmall(
          color: problem == null ? theme.textMuted : theme.error,
        ),
      ),
    ),
  );
}

enum _Working { nothing, moving, summarising, cancelling }
