import 'package:flutter/material.dart';

import '../../widgets/chat/detail_sheet.dart';

class GitCommitSheet extends StatefulWidget {
  const GitCommitSheet({
    super.key,
    this.initialMessage,
    required this.onCommit,
  });

  final String? initialMessage;
  final Future<void> Function(String message) onCommit;

  static Future<void> show({
    required BuildContext context,
    String? initialMessage,
    required Future<void> Function(String message) onCommit,
  }) {
    return DetailSheet.show<void>(
      context: context,
      title: 'Commit',
      initialSize: 0.45,
      child: GitCommitSheet(initialMessage: initialMessage, onCommit: onCommit),
    );
  }

  @override
  State<GitCommitSheet> createState() => _GitCommitSheetState();
}

class _GitCommitSheetState extends State<GitCommitSheet> {
  late final TextEditingController _controller;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.initialMessage ?? '');
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _commit() async {
    final msg = _controller.text.trim();
    if (msg.isEmpty) return;

    setState(() => _saving = true);
    try {
      await widget.onCommit(msg);
      if (!mounted) return;
      Navigator.pop(context);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _controller,
            maxLines: 4,
            minLines: 3,
            decoration: const InputDecoration(
              labelText: 'Commit message',
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: _saving ? null : _commit,
              icon: _saving
                  ? const SizedBox(
                      width: 14,
                      height: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.check_rounded),
              label: Text(_saving ? 'Committing…' : 'Commit'),
            ),
          ),
        ],
      ),
    );
  }
}
