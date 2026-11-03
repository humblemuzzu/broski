import 'package:broski/contract/generated/contract.dart';
import 'package:broski/models/message.dart';
import 'package:broski/screens/agent/chat/agent_chat_screen.dart';
import 'package:broski/screens/agent/chat/attachment_view.dart';
import 'package:broski/screens/agent/chat/chat_rows.dart';
import 'package:broski/screens/agent/chat/chat_tool_call.dart';
import 'package:broski/screens/agent/chat/file_change_view.dart';
import 'package:broski/screens/agent/chat/timeline_entry.dart';
import 'package:broski/screens/agent/chat/turn_view.dart';
import 'package:broski/screens/chat/tool_card_builder.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/message_helpers.dart';
import 'package:flutter/material.dart';

/// A tool call as the app's compact card for its kind, with what the card
/// does not draw beneath it: how far it got while it runs, images it
/// returned, the diffs of a call whose card shows none, and the subagent it
/// ran, as a link to its session or, without one, its work set in here.
class ToolCallView extends StatelessWidget {
  const ToolCallView({
    super.key,
    required this.session,
    required this.tool,
    required this.messageId,
    required this.entry,
  });

  final SessionRef session;
  final ToolCall tool;
  final String messageId;
  final ToolEntry? entry;

  @override
  Widget build(BuildContext context) {
    final entry = this.entry;
    final child = entry?.childSession;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        buildToolCard(tool: tool, messageId: messageId),
        if (entry?.running?.progress case final progress?)
          _Progress(text: progress),
        if (entry != null) ..._extras(entry),
        if (child != null)
          _SubagentLink(session: child)
        else if (entry != null && entry.nested.isNotEmpty)
          _NestedWork(session: session, nested: entry.nested),
      ],
    );
  }

  List<Widget> _extras(ToolEntry entry) {
    final images = [
      for (final content in entry.result?.result.content ?? const [])
        if (content case final AttachmentRef attachment) attachment,
    ];
    return [
      if (images.isNotEmpty)
        Padding(
          padding: Insets.topSm,
          child: AttachmentRow(
            session: session,
            attachments: images,
            alignment: WrapAlignment.start,
          ),
        ),
      if (!_cardShowsChanges(tool.name))
        for (final change in toolFileChanges(entry))
          Padding(
            padding: Insets.topSm,
            child: FileChangeView(change: change),
          ),
    ];
  }
}

/// Whether the compact card for [name] draws the call's changes itself:
/// the edit card its diff, the write card the content written.
bool _cardShowsChanges(String name) {
  final kind = name.toLowerCase().replaceFirst('mcp_', '');
  return isEditTool(kind) || kind == 'write';
}

class _Progress extends StatelessWidget {
  const _Progress({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: 4, left: 4),
    child: Text(
      text,
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: TextStyle(
        color: OpenCodeTheme.of(context).textMuted,
        fontSize: 11,
      ),
    ),
  );
}

/// A subagent's work that came inside the call, with no session of its own
/// to open: its turns, set in under the card.
class _NestedWork extends StatelessWidget {
  const _NestedWork({required this.session, required this.nested});

  final SessionRef session;
  final List<TimelineEntry> nested;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.only(left: Spacing.md, top: Spacing.sm),
      padding: const EdgeInsets.only(left: Spacing.md),
      decoration: BoxDecoration(
        border: Border(left: BorderSide(color: theme.borderSubtle, width: 2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final row in chatRowsOf(nested))
            if (row case final TurnRow turn)
              TurnView(session: session, row: turn),
        ],
      ),
    );
  }
}

class _SubagentLink extends StatelessWidget {
  const _SubagentLink({required this.session});

  final SessionRef session;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Align(
      alignment: Alignment.centerLeft,
      child: GestureDetector(
        onTap: () => openSession(context, session),
        child: Padding(
          padding: const EdgeInsets.only(top: 6, left: 4),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(AppIcons.openExternal, size: 13, color: theme.info),
              const SizedBox(width: 6),
              Text(
                'Open the subagent session',
                style: TextStyle(
                  color: theme.info,
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
