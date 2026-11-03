import 'package:broski/contract/generated/contract.dart';
import 'package:broski/screens/agent/composer/command_picker.dart';
import 'package:broski/screens/agent/composer/composer_extras.dart';
import 'package:broski/screens/agent/shared/sheet_action_tile.dart';
import 'package:broski/screens/agent/shared/text_entry_dialog.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

/// Whether the backend takes anything beside the text of a prompt.
bool takesExtras(Capabilities capabilities) =>
    capabilities.attachments.isNotEmpty ||
    capabilities.mentions.isNotEmpty ||
    capabilities.commands;

/// The chat's "Add Attachment" sheet: one row per kind of extra the backend
/// takes. [onAdd] is given what the person chose, once the sheet closed.
void showComposerAttachSheet(
  BuildContext context, {
  required SessionRef session,
  required String? cwd,
  required Capabilities capabilities,
  required void Function(ComposerExtras Function(ComposerExtras)) onAdd,
}) {
  final rows = _rows(context, session, cwd, capabilities, onAdd);
  DetailSheet.show<void>(
    context: context,
    title: 'Add Attachment',
    initialSize: (0.18 + rows.length * 0.08).clamp(0.3, 0.75),
    child: Builder(
      builder: (sheetContext) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final row in rows)
            SheetActionTile(
              key: ValueKey(row.key),
              icon: row.icon,
              label: row.label,
              detail: row.detail,
              onTap: () {
                Navigator.of(sheetContext).pop();
                row.run();
              },
            ),
        ],
      ),
    ),
  );
}

typedef _Row = ({
  String key,
  IconData icon,
  String label,
  String? detail,
  Future<void> Function() run,
});

List<_Row> _rows(
  BuildContext context,
  SessionRef session,
  String? cwd,
  Capabilities capabilities,
  void Function(ComposerExtras Function(ComposerExtras)) onAdd,
) {
  final choices = _Choices(context, session, cwd, onAdd);
  return [
    if (capabilities.attachments.contains(AttachmentKind.image))
      ...choices.images(),
    if (capabilities.attachments.contains(AttachmentKind.file)) choices.file(),
    if (capabilities.mentions.contains(MentionKind.file)) choices.fileMention(),
    if (capabilities.mentions.contains(MentionKind.agent))
      choices.agentMention(),
    if (capabilities.commands) choices.command(),
  ];
}

/// The rows of the sheet, each adding what the person chose to the prompt.
final class _Choices {
  _Choices(this.context, this.session, this.cwd, this.onAdd);

  final BuildContext context;
  final SessionRef session;
  final String? cwd;
  final void Function(ComposerExtras Function(ComposerExtras)) onAdd;

  Future<void> _image(ImageSource source) async {
    try {
      final picked = await pickImage(source);
      if (picked != null) onAdd((extras) => extras.withAttachment(picked));
    } on FormatException catch (error) {
      if (context.mounted) showProblem(context, error.message);
    }
  }

  Future<void> _ask(String title, void Function(String text) use) async {
    final text = await askForText(context, title: title, action: 'Add');
    if (text != null) use(text);
  }

  List<_Row> images() => [
    (
      key: 'attach-camera',
      icon: AppIcons.camera,
      label: 'Take Photo',
      detail: null,
      run: () => _image(ImageSource.camera),
    ),
    (
      key: 'attach-image',
      icon: AppIcons.photoLibrary,
      label: 'Choose from Gallery',
      detail: null,
      run: () => _image(ImageSource.gallery),
    ),
  ];

  _Row file() => (
    key: 'attach-file',
    icon: AppIcons.attach,
    label: 'Attach a File on the Mac',
    detail: 'Its path on the Mac',
    run: () => _ask('Path of the file on the Mac', (path) {
      onAdd((extras) => extras.withAttachment(FileContent(uri: path)));
    }),
  );

  _Row fileMention() => (
    key: 'mention-file',
    icon: AppIcons.fileText,
    label: 'Mention a File (@)',
    detail: 'Or type @ in the input to search files',
    run: () => _ask('Path of the file to mention', (path) {
      onAdd((extras) => extras.withMention(FileMention(path: path)));
    }),
  );

  _Row agentMention() => (
    key: 'mention-agent',
    icon: AppIcons.agent,
    label: 'Mention an Agent',
    detail: null,
    run: () => _ask('Name of the agent', (name) {
      onAdd((extras) => extras.withMention(AgentMention(name: name)));
    }),
  );

  _Row command() => (
    key: 'pick-command',
    icon: AppIcons.terminal,
    label: 'Run a Command (/)',
    detail: 'Or type / in the input',
    run: () async {
      final picked = await pickCommand(context, session, cwd);
      if (picked != null) onAdd((extras) => extras.withCommand(picked));
    },
  );
}
