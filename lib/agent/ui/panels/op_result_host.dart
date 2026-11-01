import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// The body of a result sheet. A result that has controls (a switch, a choice,
/// a next page) calls the backend again through [ResultActions] and shows the
/// answer in its place; a refusal is told above it and leaves it as it was.
class OpResultHost extends StatefulWidget {
  const OpResultHost({
    super.key,
    required this.client,
    required this.target,
    required this.first,
    required this.builder,
  });

  final ContractClient client;
  final OpTarget target;
  final BackendOpResult first;

  /// Shows a result with the controls [ResultActions] gives it.
  final Widget Function(BackendOpResult result, ResultActions actions) builder;

  @override
  State<OpResultHost> createState() => _OpResultHostState();
}

class _OpResultHostState extends State<OpResultHost> {
  late BackendOpResult _result = widget.first;
  String? _problem;
  bool _busy = false;

  Future<void> _call(BackendCall Function(OpTarget target) build) async {
    setState(() {
      _busy = true;
      _problem = null;
    });
    final outcome = await widget.client.callBackend(build(widget.target));
    if (!mounted) return;
    setState(() {
      _busy = false;
      switch (outcome) {
        case Done(value: final result):
          _result = result;
        case Refused() || Unreached():
          _problem = problemOf(outcome);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_problem case final problem?)
          Padding(
            key: const ValueKey('result-problem'),
            padding: Insets.section,
            child: Text(
              problem,
              style: AppTypography.bodySmall(color: theme.error),
            ),
          ),
        widget.builder(_result, ResultActions(call: _call, busy: _busy)),
      ],
    );
  }
}
