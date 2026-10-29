import 'package:broski/agent/ui/chat/attachment_view.dart';
import 'package:broski/agent/ui/chat/timeline_entry.dart';
import 'package:broski/agent/ui/chat/turn_markers.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/adaptive_markdown_body.dart'
    show AdaptiveMarkdownBody;
import 'package:flutter/material.dart';

/// What a person said, with what they attached.
class UserView extends StatelessWidget {
  const UserView({super.key, required this.session, required this.item});

  final SessionRef session;
  final UserMessageItem item;

  @override
  Widget build(BuildContext context) => UserBubble(
    text: item.text,
    footer: [
      for (final attachment in item.attachments)
        AttachmentView(session: session, attachment: attachment),
    ],
  );
}

class UserBubble extends StatelessWidget {
  const UserBubble({super.key, required this.text, this.footer = const []});

  final String text;
  final List<Widget> footer;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: Insets.bottomSm,
        padding: Insets.cardSm,
        constraints: const BoxConstraints(maxWidth: 520),
        decoration: BoxDecoration(
          color: theme.primary.withValues(alpha: 0.12),
          borderRadius: Radii.brLg,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            SelectableText(text, style: AppTypography.body(color: theme.text)),
            ...footer,
          ],
        ),
      ),
    );
  }
}

/// One text, thinking or plan block. Thinking folds away; a plan the agent
/// proposes is set apart as one.
class BlockView extends StatefulWidget {
  const BlockView({super.key, required this.entry});

  final BlockEntry entry;

  @override
  State<BlockView> createState() => _BlockViewState();
}

class _BlockViewState extends State<BlockView> {
  var _open = false;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final entry = widget.entry;
    return Padding(
      padding: Insets.bottomSm,
      child: switch (entry.kind) {
        BlockKind.text => AdaptiveMarkdownBody(
          data: entry.text,
          selectable: true,
        ),
        BlockKind.thinking => InkWell(
          onTap: () => setState(() => _open = !_open),
          child: Text(
            entry.text.isEmpty ? 'Thinking…' : entry.text,
            maxLines: _open ? null : 2,
            overflow: _open ? null : TextOverflow.ellipsis,
            style: AppTypography.bodySmall(
              color: theme.textMuted,
            ).copyWith(fontStyle: FontStyle.italic),
          ),
        ),
        BlockKind.plan => Container(
          padding: Insets.cardSm,
          decoration: BoxDecoration(
            border: Border.all(color: theme.borderActive),
            borderRadius: Radii.brMd,
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Proposed plan',
                style: AppTypography.label(color: theme.primary),
              ),
              AdaptiveMarkdownBody(data: entry.text),
            ],
          ),
        ),
      },
    );
  }
}

/// A transcript row that is not a turn.
class MarkerView extends StatelessWidget {
  const MarkerView({super.key, required this.item});

  final TranscriptItem item;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final (text, color) = markerText(item, theme);
    return Padding(
      padding: Insets.bottomSm,
      child: Text(text, style: AppTypography.caption(color: color)),
    );
  }
}

class DroppedView extends StatelessWidget {
  const DroppedView({super.key, required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => Padding(
    padding: Insets.bottomSm,
    child: Text(
      '$count earlier items of this run appear once it is saved',
      style: AppTypography.caption(color: OpenCodeTheme.of(context).textMuted),
    ),
  );
}
