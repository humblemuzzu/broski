import 'package:broski/agent/client/outcome.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/config_inputs.dart';
import 'package:broski/screens/agent/panels/editable_file_view.dart';
import 'package:broski/screens/agent/panels/op_panel.dart';
import 'package:broski/screens/agent/panels/result_actions.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Opens the file the call [read] gives, in place of the list.
typedef OpenFile =
    Future<void> Function(BackendCall Function(OpTarget target) read);

/// A list of files shown by [listBuilder], and the file opened from it with
/// a way back. Going back reads the list again with [reload], so what was
/// saved or deleted shows in it. [listOf] picks the list [L] out of an answer.
class FileDrillDown<L extends BackendOpResult> extends StatefulWidget {
  const FileDrillDown({
    super.key,
    required this.list,
    required this.listOf,
    required this.reload,
    required this.fileCall,
    required this.actions,
    required this.listBuilder,
  });

  final L list;
  final L? Function(BackendOpResult result) listOf;
  final BackendCall Function(OpTarget target) reload;
  final FileCall fileCall;
  final ResultActions actions;
  final Widget Function(BuildContext context, L list, OpenFile open)
  listBuilder;

  @override
  State<FileDrillDown<L>> createState() => _FileDrillDownState<L>();
}

class _FileDrillDownState<L extends BackendOpResult>
    extends State<FileDrillDown<L>> {
  late L _list = widget.list;
  EditableFile? _file;
  String? _problem;

  @override
  void didUpdateWidget(FileDrillDown<L> old) {
    super.didUpdateWidget(old);
    if (old.list != widget.list) _list = widget.list;
  }

  Future<void> _open(BackendCall Function(OpTarget target) read) async {
    final outcome = await widget.actions.attempt(read);
    if (!mounted) return;
    final opened = outcome is Done<BackendOpResult>
        ? fileOf(outcome.value)
        : null;
    setState(() {
      _file = opened ?? _file;
      _problem = opened == null ? _unexpected(outcome) : null;
    });
  }

  Future<void> _back() async {
    setState(() => _file = null);
    final outcome = await widget.actions.attempt(widget.reload);
    if (!mounted) return;
    final listed = outcome is Done<BackendOpResult>
        ? widget.listOf(outcome.value)
        : null;
    setState(() {
      _list = listed ?? _list;
      _problem = listed == null ? _unexpected(outcome) : null;
    });
  }

  String _unexpected(Outcome<BackendOpResult> outcome) =>
      problemOf(outcome) ?? 'The Mac answered with something else.';

  @override
  Widget build(BuildContext context) {
    final file = _file;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_problem case final problem?) _Problem(problem: problem),
        if (file == null)
          widget.listBuilder(context, _list, _open)
        else
          EditableFileView(
            key: ValueKey('file:${file.id}'),
            file: file,
            actions: widget.actions,
            call: widget.fileCall,
            onBack: _back,
            onDeleted: _back,
          ),
      ],
    );
  }
}

/// Why the file or the list could not be read, while what was shown stays.
class _Problem extends StatelessWidget {
  const _Problem({required this.problem});

  final String problem;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      key: const ValueKey('drill-problem'),
      margin: const EdgeInsets.fromLTRB(Spacing.lg, Spacing.md, Spacing.lg, 0),
      padding: Insets.cardMd,
      decoration: BoxDecoration(
        color: theme.error.withValues(alpha: 0.10),
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.error.withValues(alpha: 0.25)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(AppIcons.error, size: 16, color: theme.error),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              problem,
              style: AppTypography.bodySmall(color: theme.error),
            ),
          ),
        ],
      ),
    );
  }
}
