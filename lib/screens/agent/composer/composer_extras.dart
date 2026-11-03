import 'dart:convert';

import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/file_attachment.dart';
import 'package:broski/screens/agent/composer/composer_rules.dart';
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
    command: identical(command, extra) ? null : command,
  );

  /// Each attachment and mention as the input bar's attached-file chip
  /// draws it (the chip puts the `@` before a path itself), with the extra
  /// it stands for, so removing a chip removes that extra. The command is
  /// not a chip: it says what it takes above the bar.
  List<(FileAttachment, Object)> get chips => [
    for (final attachment in attachments)
      (_attachmentChip(attachment), attachment),
    for (final mention in mentions)
      (
        FileAttachment.fromPath(switch (mention) {
          FileMention(:final path) => path,
          AgentMention(:final name) => name,
        }),
        mention,
      ),
  ];
}

FileAttachment _attachmentChip(Attachment attachment) => switch (attachment) {
  ImageContent(:final name, :final mimeType, :final data) =>
    FileAttachment.fromImage(
      filename: name ?? 'image',
      mimeType: mimeType,
      base64Data: data,
      thumbnailBytes: base64Decode(data),
    ),
  FileContent(:final uri) => FileAttachment.fromPath(uri),
};

/// An image the person picks from [source], or null when they picked none;
/// throws [FormatException] when what they picked is not an image.
Future<ImageContent?> pickImage(ImageSource source) async {
  final picked = await ImagePicker().pickImage(source: source);
  if (picked == null) return null;
  final mimeType = picked.mimeType ?? lookupMimeType(picked.name);
  if (mimeType == null || !mimeType.startsWith('image/')) {
    throw const FormatException('That is not an image');
  }
  return imageAttachment(
    bytes: await picked.readAsBytes(),
    mimeType: mimeType,
    name: picked.name,
  );
}
