import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Builds the call that writes the file shown.
typedef FileEditCall =
    BackendCall Function(OpTarget target, EditableFileChange change);

/// One text file a backend lets the person read and edit (contract
/// `EditableFile`): its path and what is wrong with it, its text, and Save
/// while it may be changed. A save carries the revision read, so an edit made
/// against a copy that changed since is refused rather than lost.
class EditableFileView extends StatefulWidget {
  const EditableFileView({
    super.key,
    required this.file,
    required this.actions,
    required this.change,
  });

  final EditableFile file;
  final ResultActions actions;
  final FileEditCall change;

  @override
  State<EditableFileView> createState() => _EditableFileViewState();
}

class _EditableFileViewState extends State<EditableFileView> {
  late final _text = TextEditingController(text: widget.file.text);

  @override
  void didUpdateWidget(EditableFileView old) {
    super.didUpdateWidget(old);
    if (old.file != widget.file) _text.text = widget.file.text;
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final file = widget.file;
    final muted = AppTypography.bodySmall(color: theme.textMuted);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(file.path, style: muted),
        Text(
          file.exists ? file.scope : '${file.scope} · new file',
          style: muted,
        ),
        for (final problem in file.problems)
          Text(problem, style: AppTypography.bodySmall(color: theme.error)),
        if (file.truncated)
          Text(
            'Too long to show whole here, so it cannot be edited here.',
            style: AppTypography.bodySmall(color: theme.warning),
          ),
        Padding(
          padding: Insets.section,
          child: TextField(
            key: const ValueKey('editable-file-text'),
            controller: _text,
            readOnly: !file.editable,
            maxLines: null,
            style: AppTypography.code(),
          ),
        ),
        if (file.editable)
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              key: const ValueKey('editable-file-save'),
              onPressed: widget.actions.busy ? null : _save,
              child: const Text('Save'),
            ),
          ),
      ],
    );
  }

  Future<void> _save() => widget.actions.call(
    (target) => widget.change(
      target,
      EditableFileWrite(text: _text.text, revision: widget.file.revision),
    ),
  );
}
