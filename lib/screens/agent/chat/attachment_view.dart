import 'dart:convert';

import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/client/outcome.dart';
import 'package:broski/agent/client/requests/session_requests.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// An image read back by reference (contract §10: images travel only in a
/// prompt and in `attachment.read`).
final attachmentProvider = FutureProvider.autoDispose
    .family<Outcome<ImageContent>, ({SessionRef session, AttachmentId id})>(
      (ref, key) =>
          ref.watch(contractClientProvider).readAttachment(key.session, key.id),
    );

/// The attachments of a message, right-aligned under it.
class AttachmentRow extends StatelessWidget {
  const AttachmentRow({
    super.key,
    required this.session,
    required this.attachments,
    this.alignment = WrapAlignment.end,
  });

  final SessionRef session;
  final List<AttachmentRef> attachments;
  final WrapAlignment alignment;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: Spacing.sm),
    child: Wrap(
      alignment: alignment,
      spacing: 6,
      runSpacing: 6,
      children: [
        for (final attachment in attachments)
          AttachmentView(session: session, attachment: attachment),
      ],
    ),
  );
}

/// One attachment in the chat's attached-file chip style: an image opens
/// when tapped, a file names its path on the Mac.
class AttachmentView extends StatelessWidget {
  const AttachmentView({
    super.key,
    required this.session,
    required this.attachment,
  });

  final SessionRef session;
  final AttachmentRef attachment;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return switch (attachment) {
      ImageRef(:final id, :final name, :final mimeType) => GestureDetector(
        onTap: () => DetailSheet.show<void>(
          context: context,
          title: name ?? 'Image',
          child: _StoredImage(session: session, id: id),
        ),
        child: _Chip(
          icon: AppIcons.image,
          label: name ?? mimeType,
          color: theme.primary,
        ),
      ),
      FileContent(:final uri, :final name) => _Chip(
        icon: AppIcons.description,
        label: name ?? uri,
        color: theme.info,
      ),
    };
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.label, required this.color});

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.15),
      borderRadius: Radii.brSm,
      border: Border.all(color: color.withValues(alpha: 0.3)),
    ),
    child: Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 6),
        Flexible(
          child: Text(
            label,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              color: color,
              fontSize: 12,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    ),
  );
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
