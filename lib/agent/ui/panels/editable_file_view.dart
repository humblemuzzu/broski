import 'package:broski/agent/ui/panels/file_notices.dart';
import 'package:broski/agent/ui/panels/file_verdict.dart';
import 'package:broski/agent/ui/panels/op_panel.dart';
import 'package:broski/agent/ui/panels/result_actions.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Builds the call that reads [file], or changes it first when [change] is
/// given.
typedef FileCall =
    BackendCall Function(
      OpTarget target,
      EditableFile file,
      EditableFileChange? change,
    );

/// One text file a backend lets the person read and edit (contract
/// `EditableFile`). The text is edited in place and saved at the revision
/// read, so an edit made against a copy that changed since is refused, never
/// written over the newer one: the refusal is told, the text kept, and the
/// person decides whether to reload. A file that is not `editable`, or is
/// `truncated`, is shown read-only. [onBack] goes back to the list the file
/// was opened from; [onDeleted] is called once a delete succeeded.
class EditableFileView extends StatefulWidget {
  const EditableFileView({
    super.key,
    required this.file,
    required this.actions,
    required this.call,
    this.onBack,
    this.onDeleted,
  });

  final EditableFile file;
  final ResultActions actions;
  final FileCall call;
  final VoidCallback? onBack;
  final VoidCallback? onDeleted;

  @override
  State<EditableFileView> createState() => _EditableFileViewState();
}

class _EditableFileViewState extends State<EditableFileView> {
  late EditableFile _file = widget.file;
  late final _text = TextEditingController(text: _file.text);
  FileRefusal? _refusal;
  String? _done;

  bool get _dirty => _text.text != _file.text;
  bool get _tooLong => _text.text.length > contractMaxTextChars;

  @override
  void didUpdateWidget(EditableFileView old) {
    super.didUpdateWidget(old);
    if (old.file != widget.file) _adopt(widget.file, done: null);
  }

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  void _adopt(EditableFile file, {required String? done}) {
    _file = file;
    _text.text = file.text;
    _refusal = null;
    _done = done;
  }

  Future<void> _run(
    EditableFileChange? change, {
    required String? done,
    VoidCallback? then,
  }) async {
    final verdict = fileVerdictOf(
      await widget.actions.attempt(
        (target) => widget.call(target, _file, change),
      ),
    );
    if (!mounted) return;
    switch (verdict) {
      case FileDone(:final file):
        setState(() => _adopt(file, done: done));
        then?.call();
      case final FileRefusal refusal:
        setState(() {
          _refusal = refusal;
          _done = null;
        });
    }
  }

  Future<void> _save() => _run(
    EditableFileWrite(text: _text.text, revision: _file.revision),
    done: 'Saved.',
  );

  Future<void> _delete() async {
    final confirmed = await askToConfirm(
      context,
      title: 'Delete ${_file.path}?',
      body: 'The file is removed from the Mac. This cannot be undone.',
      action: 'Delete',
    );
    if (!confirmed || !mounted) return;
    await _run(
      EditableFileDelete(revision: _file.revision),
      done: 'Deleted.',
      then: widget.onDeleted,
    );
  }

  Future<void> _back() async {
    final onBack = widget.onBack;
    if (onBack == null) return;
    if (_dirty && _file.editable) {
      final discard = await askToConfirm(
        context,
        title: 'Discard your edit?',
        body: 'The changes to this file were not saved.',
        action: 'Discard',
      );
      if (!discard) return;
    }
    onBack();
  }

  @override
  Widget build(BuildContext context) {
    final busy = widget.actions.busy;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Toolbar(
          file: _file,
          canGoBack: widget.onBack != null,
          saveEnabled: !busy && !_tooLong && (_dirty || !_file.exists),
          deleteEnabled: !busy,
          backEnabled: !busy,
          onBack: _back,
          onSave: _save,
          onDelete: _delete,
        ),
        if (busy)
          const LinearProgressIndicator(
            minHeight: 2,
            semanticsLabel: 'Working',
          ),
        FileHeader(file: _file),
        if (_refusal case final refusal?)
          FileRefusalBanner(
            verdict: refusal,
            busy: busy,
            onReload: () => _run(null, done: null),
          ),
        Padding(
          padding: Insets.section,
          child: TextField(
            key: const ValueKey('editable-file-text'),
            controller: _text,
            readOnly: !_file.editable || busy,
            minLines: 8,
            maxLines: 20,
            autocorrect: false,
            enableSuggestions: false,
            keyboardType: TextInputType.multiline,
            style: AppTypography.code(),
            onChanged: (_) => setState(() => _done = null),
          ),
        ),
        _status(OpenCodeTheme.of(context)),
      ],
    );
  }

  Widget _status(OpenCodeTheme theme) {
    final length = _text.text.length;
    final over = length - contractMaxTextChars;
    return Text(
      over > 0
          ? 'Over the limit by $over characters: cut some to save.'
          : _done ?? '$length characters',
      key: const ValueKey('file-status'),
      style: AppTypography.caption(
        color: over > 0 ? theme.error : theme.textMuted,
      ),
    );
  }
}

/// Back, Delete and Save sit above the text, so they stay in reach however
/// long the file is.
class _Toolbar extends StatelessWidget {
  const _Toolbar({
    required this.file,
    required this.canGoBack,
    required this.backEnabled,
    required this.saveEnabled,
    required this.deleteEnabled,
    required this.onBack,
    required this.onSave,
    required this.onDelete,
  });

  final EditableFile file;
  final bool canGoBack;
  final bool backEnabled;
  final bool saveEnabled;
  final bool deleteEnabled;
  final VoidCallback onBack;
  final VoidCallback onSave;
  final VoidCallback onDelete;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Row(
      children: [
        if (canGoBack)
          TextButton.icon(
            key: const ValueKey('file-back'),
            onPressed: backEnabled ? onBack : null,
            icon: const Icon(Icons.arrow_back, size: 16),
            label: const Text('Files'),
          ),
        const Spacer(),
        if (file.editable && file.exists)
          TextButton(
            key: const ValueKey('editable-file-delete'),
            style: TextButton.styleFrom(foregroundColor: theme.error),
            onPressed: deleteEnabled ? onDelete : null,
            child: const Text('Delete'),
          ),
        if (file.editable)
          FilledButton(
            key: const ValueKey('editable-file-save'),
            onPressed: saveEnabled ? onSave : null,
            child: Text(file.exists ? 'Save' : 'Create'),
          ),
      ],
    );
  }
}
