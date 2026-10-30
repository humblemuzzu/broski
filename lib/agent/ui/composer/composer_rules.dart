import 'dart:convert';

import 'package:broski/contract/generated/contract.dart';

/// The ways a prompt can go in now (contract §10): `start` while idle; while
/// a run is on, the modes that join it, `steer` or `queue`, where the
/// backend takes them. Empty: nothing can be sent until the run ends.
List<PromptMode> composerModes(
  Capabilities capabilities, {
  required bool running,
}) => running
    ? [
        for (final mode in capabilities.promptModes)
          if (mode != PromptMode.start) mode,
      ]
    : const [PromptMode.start];

/// The composer's text once input the backend handed back joins [typed], as
/// a terminal's own composer takes it back after Esc: the returned messages in queue
/// order, a blank line between them, then what was typed, each part only when
/// it holds more than whitespace.
String withReturnedInput(List<String> returned, String typed) => [
  returned.join('\n\n'),
  typed,
].where((piece) => piece.trim().isNotEmpty).join('\n\n');

/// Why the prompt cannot be sent as it stands, or null.
String? composerProblem({
  required String text,
  required List<Attachment> attachments,
  required CommandId? command,
}) {
  if (text.trim().isEmpty && attachments.isEmpty && command == null) {
    return 'Write something to send';
  }
  if (text.length > contractMaxTextChars) return 'The message is too long';
  final imageChars = attachments.fold<int>(
    0,
    (sum, attachment) =>
        sum + (attachment is ImageContent ? attachment.data.length : 0),
  );
  if (imageChars > contractMaxImageChars) {
    return 'The images are larger than one message carries (4 MiB together)';
  }
  return null;
}

ImageContent imageAttachment({
  required List<int> bytes,
  required String mimeType,
  String? name,
}) => ImageContent(mimeType: mimeType, data: base64Encode(bytes), name: name);
