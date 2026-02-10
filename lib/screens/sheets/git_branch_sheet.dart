import 'package:flutter/material.dart';

import '../../models/git.dart';
import '../../widgets/chat/detail_sheet.dart';
import '../../theme/design_tokens.dart';

class GitBranchSheet extends StatefulWidget {
  const GitBranchSheet({
    super.key,
    required this.branches,
    required this.onCheckout,
    required this.onCreateBranch,
  });

  final List<GitBranch> branches;
  final Future<void> Function(String branch) onCheckout;
  final Future<void> Function(String name) onCreateBranch;

  static Future<void> show({
    required BuildContext context,
    required List<GitBranch> branches,
    required Future<void> Function(String branch) onCheckout,
    required Future<void> Function(String name) onCreateBranch,
  }) {
    return DetailSheet.show<void>(
      context: context,
      title: 'Branches',
      initialSize: 0.7,
      child: GitBranchSheet(
        branches: branches,
        onCheckout: onCheckout,
        onCreateBranch: onCreateBranch,
      ),
    );
  }

  @override
  State<GitBranchSheet> createState() => _GitBranchSheetState();
}

class _GitBranchSheetState extends State<GitBranchSheet> {
  final _controller = TextEditingController();
  bool _creating = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final name = _controller.text.trim();
    if (name.isEmpty) return;

    setState(() => _creating = true);
    try {
      await widget.onCreateBranch(name);
      _controller.clear();
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final local = widget.branches.where((b) => !b.isRemote).toList();

    return Padding(
      padding: Insets.cardSm,
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _controller,
                  decoration: const InputDecoration(
                    labelText: 'New branch name',
                    border: OutlineInputBorder(),
                    isDense: true,
                  ),
                ),
              ),
              SizedBox(width: Spacing.sm),
              FilledButton(
                onPressed: _creating ? null : _create,
                child: Text(_creating ? 'Creating…' : 'Create'),
              ),
            ],
          ),
          SizedBox(height: Spacing.md),
          ...local.map((branch) {
            return ListTile(
              dense: true,
              title: Text(branch.name),
              subtitle: branch.tracking != null ? Text(branch.tracking!) : null,
              leading: Icon(
                branch.isCurrent
                    ? Icons.check_circle_rounded
                    : Icons.circle_outlined,
                size: 18,
              ),
              onTap: branch.isCurrent
                  ? null
                  : () async {
                      await widget.onCheckout(branch.name);
                    },
            );
          }),
        ],
      ),
    );
  }
}
