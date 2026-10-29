import 'dart:convert';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/widgets/chat/detail_sheet.dart' show DetailSheet;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// An image read back by reference (contract §10: images travel only in a
/// prompt and in `attachment.read`).
final attachmentProvider = FutureProvider.autoDispose
    .family<Outcome<ImageContent>, ({SessionRef session, AttachmentId id})>(
      (ref, key) =>
          ref.watch(contractClientProvider).readAttachment(key.session, key.id),
    );

/// One attachment of a message: an image opens when tapped, a file names
/// its path on the Mac.
class AttachmentView extends StatelessWidget {
  const AttachmentView({
    super.key,
    required this.session,
    required this.attachment,
  });

  final SessionRef session;
  final AttachmentRef attachment;

  @override
  Widget build(BuildContext context) => switch (attachment) {
    ImageRef(:final id, :final name, :final mimeType) => ActionChip(
      avatar: const Icon(AppIcons.image, size: 16),
      label: Text(name ?? mimeType),
      onPressed: () => DetailSheet.show<void>(
        context: context,
        title: name ?? 'Image',
        child: _StoredImage(session: session, id: id),
      ),
    ),
    FileContent(:final uri, :final name) => Chip(
      avatar: const Icon(AppIcons.file, size: 16),
      label: Text(name ?? uri),
    ),
  };
}

class _StoredImage extends ConsumerWidget {
  const _StoredImage({required this.session, required this.id});

  final SessionRef session;
  final AttachmentId id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final image = ref.watch(attachmentProvider((session: session, id: id)));
    return switch (image.valueOrNull) {
      null => const Center(
        child: CircularProgressIndicator(semanticsLabel: 'Loading the image'),
      ),
      Done(value: final content) => Image.memory(base64Decode(content.data)),
      final failed => Text(problemOf(failed) ?? ''),
    };
  }
}
