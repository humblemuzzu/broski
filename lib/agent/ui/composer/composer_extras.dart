import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/ui/composer/command_picker.dart';
import 'package:broski/agent/ui/composer/composer_rules.dart';
import 'package:broski/agent/ui/shared/text_entry_dialog.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mime/mime.dart';

/// What goes with the text of a prompt.
final class ComposerExtras {
  const ComposerExtras({
    this.attachments = const [],
    this.mentions = const [],
    this.command,
  });

  final List<Attachment> attachments;
  final List<Mention> mentions;
  final CommandSummary? command;

  ComposerExtras withAttachment(Attachment attachment) => ComposerExtras(
    attachments: [...attachments, attachment],
    mentions: mentions,
    command: command,
  );

  ComposerExtras withMention(Mention mention) => ComposerExtras(
    attachments: attachments,
    mentions: [...mentions, mention],
    command: command,
  );

  ComposerExtras withCommand(CommandSummary? next) => ComposerExtras(
    attachments: attachments,
    mentions: mentions,
    command: next,
  );

  ComposerExtras without(Object extra) => ComposerExtras(
    attachments: [
      for (final held in attachments)
        if (!identical(held, extra)) held,
    ],
    mentions: [
      for (final held in mentions)
        if (!identical(held, extra)) held,
    ],
    command: command,
  );
}

/// Buttons for each kind of extra the backend takes, and the extras chosen.
class ComposerExtrasRow extends StatelessWidget {
  const ComposerExtrasRow({
    super.key,
    required this.session,
    required this.state,
    required this.capabilities,
    required this.extras,
    required this.onChanged,
  });

  final SessionRef session;
  final AgentSessionState state;
  final Capabilities capabilities;
  final ComposerExtras extras;
  final ValueChanged<ComposerExtras> onChanged;

  Future<void> _image(BuildContext context) async {
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked == null) return;
    final mimeType = picked.mimeType ?? lookupMimeType(picked.name);
    if (mimeType == null || !mimeType.startsWith('image/')) {
      if (context.mounted) showProblem(context, 'That is not an image');
      return;
    }
    final bytes = await picked.readAsBytes();
    onChanged(
      extras.withAttachment(
        imageAttachment(bytes: bytes, mimeType: mimeType, name: picked.name),
      ),
    );
  }

  Future<void> _ask(
    BuildContext context,
    String title,
    void Function(String text) use,
  ) async {
    final text = await askForText(context, title: title, action: 'Add');
    if (text != null) use(text);
  }

  @override
  Widget build(BuildContext context) {
    final command = extras.command;
    return Wrap(
      children: [
        ..._buttons(context),
        if (command != null)
          InputChip(
            label: Text(command.name),
            onDeleted: () => onChanged(extras.withCommand(null)),
          ),
        for (final attachment in extras.attachments)
          InputChip(
            label: Text(switch (attachment) {
              ImageContent(:final name) => name ?? 'Image',
              FileContent(:final uri) => uri,
            }),
            onDeleted: () => onChanged(extras.without(attachment)),
          ),
        for (final mention in extras.mentions)
          InputChip(
            label: Text(switch (mention) {
              FileMention(:final path) => '@$path',
              AgentMention(:final name) => '@$name',
            }),
            onDeleted: () => onChanged(extras.without(mention)),
          ),
      ],
    );
  }

  /// One button per kind of extra the backend declares.
  List<Widget> _buttons(BuildContext context) {
    final kinds = capabilities.attachments;
    final mentionKinds = capabilities.mentions;
    return [
      if (kinds.contains(AttachmentKind.image))
        _button(
          'attach-image',
          AppIcons.image,
          'Attach an image',
          () => _image(context),
        ),
      if (kinds.contains(AttachmentKind.file))
        _button('attach-file', AppIcons.attach, 'Attach a file on the Mac', () {
          _ask(context, 'Path of the file on the Mac', (path) {
            onChanged(extras.withAttachment(FileContent(uri: path)));
          });
        }),
      if (mentionKinds.contains(MentionKind.file))
        _button('mention-file', AppIcons.fileText, 'Mention a file', () {
          _ask(context, 'Path of the file to mention', (path) {
            onChanged(extras.withMention(FileMention(path: path)));
          });
        }),
      if (mentionKinds.contains(MentionKind.agent))
        _button('mention-agent', AppIcons.agent, 'Mention an agent', () {
          _ask(context, 'Name of the agent', (name) {
            onChanged(extras.withMention(AgentMention(name: name)));
          });
        }),
      if (capabilities.commands)
        _button('pick-command', AppIcons.terminal, 'Run a command', () async {
          final picked = await pickCommand(
            context,
            session,
            state.summary?.cwd,
          );
          if (picked != null) onChanged(extras.withCommand(picked));
        }),
    ];
  }
}

Widget _button(String key, IconData icon, String tooltip, VoidCallback onTap) =>
    IconButton(
      key: ValueKey(key),
      tooltip: tooltip,
      icon: Icon(icon, size: 18),
      onPressed: onTap,
    );
