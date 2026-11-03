import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/panels/file_notices.dart';
import 'package:broski/screens/agent/panels/file_verdict.dart';
import 'package:broski/screens/agent/panels/op_panel.dart';
import 'package:broski/screens/agent/panels/result_actions.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
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
      body:
          'The file is moved to the Trash on the Mac, where it can be restored.',
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
    final theme = OpenCodeTheme.of(context);
    final busy = widget.actions.busy;
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: Spacing.lg,
        vertical: Spacing.sm,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          EditableFileToolbar(
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
            const Padding(padding: Insets.topSm, child: FileWorkingBar()),
          const SizedBox(height: Spacing.md),
          FileHeader(file: _file),
          if (_refusal case final refusal?) ...[
            const SizedBox(height: Spacing.md),
            FileRefusalBanner(
              verdict: refusal,
              busy: busy,
              onReload: () => _run(null, done: null),
            ),
          ],
          const SizedBox(height: Spacing.md),
          _Editor(
            controller: _text,
            file: _file,
            busy: busy,
            onChanged: () => setState(() => _done = null),
          ),
          const SizedBox(height: Spacing.sm),
          FileEditStatus(length: _text.text.length, done: _done, theme: theme),
        ],
      ),
    );
  }
}

/// The text as the app edits it: in the code face, on its own surface.
class _Editor extends StatelessWidget {
  const _Editor({
    required this.controller,
    required this.file,
    required this.busy,
    required this.onChanged,
  });

  final TextEditingController controller;
  final EditableFile file;
  final bool busy;
  final VoidCallback onChanged;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return TextField(
      key: const ValueKey('editable-file-text'),
      controller: controller,
      readOnly: !file.editable || busy,
      minLines: 8,
      maxLines: 20,
      autocorrect: false,
      enableSuggestions: false,
      keyboardType: TextInputType.multiline,
      style: AppTypography.code(color: theme.text),
      onChanged: (_) => onChanged(),
      decoration: InputDecoration(
        filled: true,
        fillColor: theme.backgroundElement,
        contentPadding: Insets.input,
        border: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: theme.borderSubtle),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: theme.borderSubtle),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: Radii.brMd,
          borderSide: BorderSide(color: theme.borderActive),
        ),
      ),
    );
  }
}

/// Back, Delete and Save sit above the text, so they stay in reach however
/// long the file is.
class EditableFileToolbar extends StatelessWidget {
  const EditableFileToolbar({
    super.key,
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
          _ToolbarButton(
            key: const ValueKey('file-back'),
            icon: AppIcons.back,
            label: 'Files',
            color: theme.textMuted,
            filled: false,
            enabled: backEnabled,
            onTap: onBack,
          ),
        const Spacer(),
        if (file.editable && file.exists)
          _ToolbarButton(
            key: const ValueKey('editable-file-delete'),
            icon: AppIcons.delete,
            label: 'Delete',
            color: theme.error,
            filled: true,
            enabled: deleteEnabled,
            onTap: onDelete,
          ),
        if (file.editable) ...[
          const SizedBox(width: Spacing.sm),
          _SaveButton(enabled: saveEnabled, onTap: onSave, exists: file.exists),
        ],
      ],
    );
  }
}

class _SaveButton extends StatelessWidget {
  const _SaveButton({
    required this.enabled,
    required this.onTap,
    required this.exists,
  });

  final bool enabled;
  final VoidCallback onTap;
  final bool exists;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return FilledButton(
      key: const ValueKey('editable-file-save'),
      onPressed: enabled ? onTap : null,
      style: FilledButton.styleFrom(
        backgroundColor: theme.primary,
        foregroundColor: theme.selectedListItemText,
        disabledBackgroundColor: theme.backgroundElement,
        disabledForegroundColor: theme.textMuted,
        padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        shape: RoundedRectangleBorder(borderRadius: Radii.brSm),
      ),
      child: Text(exists ? 'Save' : 'Create'),
    );
  }
}

class _ToolbarButton extends StatelessWidget {
  const _ToolbarButton({
    super.key,
    required this.icon,
    required this.label,
    required this.color,
    required this.filled,
    required this.enabled,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final Color color;

  /// Tinted in [color] rather than set on the app's own surface.
  final bool filled;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final tone = enabled ? color : theme.border;
    return GestureDetector(
      onTap: enabled ? onTap : null,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: EdgeInsets.symmetric(
          horizontal: filled ? 12 : 10,
          vertical: filled ? 8 : 7,
        ),
        decoration: BoxDecoration(
          color: filled
              ? tone.withValues(alpha: 0.10)
              : theme.backgroundElement,
          borderRadius: Radii.brSm,
          border: filled ? null : Border.all(color: theme.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 14, color: tone),
            const SizedBox(width: 5),
            Text(
              label,
              style: AppTypography.label(color: tone).copyWith(
                fontWeight: filled ? FontWeight.w600 : FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
